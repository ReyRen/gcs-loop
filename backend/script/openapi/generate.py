#!/usr/bin/env python3
"""Generate an OpenAPI 3 document from Coze Loop Thrift HTTP annotations.

The upstream Hertz Swagger generator only documents fields with explicit
``api.body``/``api.query`` annotations. Coze Loop intentionally treats
unannotated fields on POST/PUT/PATCH requests as JSON body fields, so this
small generator mirrors the repository's actual binding rules instead.

It uses only Python's standard library to keep the documentation toolchain
independent from the application runtime and frontend workspace.
"""

from __future__ import annotations

import argparse
import ast
import json
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterable, Optional


HTTP_ANNOTATIONS = {
    "api.get": "get",
    "api.post": "post",
    "api.put": "put",
    "api.patch": "patch",
    "api.delete": "delete",
    "api.options": "options",
    "api.head": "head",
}
BODY_METHODS = {"post", "put", "patch"}
PRIMITIVES: dict[str, dict[str, Any]] = {
    "bool": {"type": "boolean"},
    "byte": {"type": "integer", "format": "int32"},
    "i8": {"type": "integer", "format": "int32"},
    "i16": {"type": "integer", "format": "int32"},
    "i32": {"type": "integer", "format": "int32"},
    "i64": {"type": "integer", "format": "int64"},
    "double": {"type": "number", "format": "double"},
    "string": {"type": "string"},
    "binary": {"type": "string", "format": "byte"},
    "void": {},
}
PUBLIC_SESSION_PATHS = {
    "/api/foundation/v1/users/register",
    "/api/foundation/v1/users/login_by_password",
}

RAW_BODY_MEDIA_TYPES = {
    "/v1/loop/files/upload": ("application/octet-stream",),
    "/v1/loop/opentelemetry/v1/traces": (
        "application/x-protobuf",
        "application/json",
    ),
}

RAW_RESPONSE_MEDIA_TYPES = {
    "/v1/loop/opentelemetry/v1/traces": ("application/x-protobuf",),
}

DIRECT_BAD_REQUEST_METHODS = {
    "ValidateDatasetItems",
    "AsyncRunEvaluator",
    "AsyncDebugEvaluator",
    "CreateExperimentTemplate",
    "UpdateExperimentTemplate",
    "DeleteExperimentTemplate",
    "ListExperimentTemplates",
    "BatchGetExperimentTemplate",
    "UpdateExperimentTemplateMeta",
    "ExportTracesToDataset",
    "PreviewExportTracesToDataset",
    "SearchTraceTree",
    "ListWorkspaceAnnotations",
    "ListMetadata",
    "DebugStreaming",
    "GeneratePrompt",
    "ExecuteStreaming",
    "BatchGetTools",
}

STREAMING_RESPONSE_TYPES = {
    "DebugStreamingResponse",
    "ExecuteStreamingResponse",
    "GeneratePromptResponse",
}


@dataclass(frozen=True)
class Token:
    kind: str
    value: str
    line: int


@dataclass
class TypeRef:
    kind: str
    name: str = ""
    args: list["TypeRef"] = field(default_factory=list)


@dataclass
class Field:
    field_id: int
    requiredness: str
    type_ref: TypeRef
    name: str
    annotations: dict[str, str]
    comments: list[str]
    default: Any = None


@dataclass
class StructDef:
    name: str
    fields: list[Field]
    comments: list[str]
    is_union: bool = False


@dataclass
class EnumDef:
    name: str
    values: list[tuple[str, int]]
    comments: list[str]


@dataclass
class TypedefDef:
    name: str
    type_ref: TypeRef
    comments: list[str]


@dataclass
class Method:
    name: str
    return_type: TypeRef
    args: list[Field]
    annotations: dict[str, str]
    comments: list[str]


@dataclass
class ServiceDef:
    name: str
    methods: list[Method]
    comments: list[str]


@dataclass
class Document:
    path: Path
    namespace: str = ""
    includes: dict[str, Path] = field(default_factory=dict)
    structs: dict[str, StructDef] = field(default_factory=dict)
    enums: dict[str, EnumDef] = field(default_factory=dict)
    typedefs: dict[str, TypedefDef] = field(default_factory=dict)
    constants: list[tuple[TypeRef, str, Any]] = field(default_factory=list)
    services: list[ServiceDef] = field(default_factory=list)


TOKEN_RE = re.compile(
    r"""
    (?P<WS>\s+)
  | (?P<LINECOMMENT>//[^\n]*|\#[^\n]*)
  | (?P<BLOCKCOMMENT>/\*.*?\*/)
  | (?P<STRING>"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')
  | (?P<NUMBER>-?\d+(?:\.\d+)?)
  | (?P<IDENT>[A-Za-z_][A-Za-z0-9_.]*)
  | (?P<SYMBOL>.)
    """,
    re.VERBOSE | re.DOTALL,
)


def tokenize(text: str) -> list[Token]:
    tokens: list[Token] = []
    line = 1
    cursor = 0
    for match in TOKEN_RE.finditer(text):
        if match.start() != cursor:
            raise ValueError(f"unable to tokenize input near offset {cursor}")
        raw = match.group(0)
        kind = match.lastgroup or "SYMBOL"
        if kind != "WS":
            value = raw
            if kind == "STRING":
                try:
                    value = ast.literal_eval(raw)
                except (SyntaxError, ValueError):
                    value = raw[1:-1]
            tokens.append(Token(kind, value, line))
        line += raw.count("\n")
        cursor = match.end()
    return tokens


def clean_comment(raw: str) -> str:
    raw = raw.strip()
    if raw.startswith("//"):
        raw = raw[2:]
    elif raw.startswith("#"):
        raw = raw[1:]
    elif raw.startswith("/*"):
        raw = raw[2:-2]
        raw = "\n".join(line.lstrip(" *") for line in raw.splitlines())
    return raw.strip()


def comment_text(comments: Iterable[str]) -> str:
    cleaned = [clean_comment(comment) for comment in comments]
    cleaned = [comment for comment in cleaned if comment]
    return "\n".join(cleaned).strip()


class ThriftParser:
    def __init__(self, path: Path, idl_root: Path):
        self.path = path.resolve()
        self.idl_root = idl_root.resolve()
        self.tokens = tokenize(path.read_text(encoding="utf-8"))
        self.pos = 0
        self.document = Document(path=self.path)

    def peek(self, value: Optional[str] = None) -> Optional[Token]:
        if self.pos >= len(self.tokens):
            return None
        token = self.tokens[self.pos]
        if value is not None and token.value != value:
            return None
        return token

    def pop(self, value: Optional[str] = None) -> Token:
        token = self.peek()
        if token is None:
            raise ValueError(f"unexpected EOF in {self.path}")
        if value is not None and token.value != value:
            raise ValueError(
                f"expected {value!r}, got {token.value!r} "
                f"at {self.path}:{token.line}"
            )
        self.pos += 1
        return token

    def consume(self, value: str) -> bool:
        if self.peek(value):
            self.pos += 1
            return True
        return False

    def consume_comments(self) -> list[str]:
        comments: list[str] = []
        while self.peek() and self.peek().kind in {"LINECOMMENT", "BLOCKCOMMENT"}:
            comments.append(self.pop().value)
        return comments

    def consume_delimiters(self) -> None:
        while self.peek() and self.peek().value in {",", ";"}:
            self.pop()

    def parse(self) -> Document:
        pending_comments: list[str] = []
        while self.peek():
            pending_comments.extend(self.consume_comments())
            if not self.peek():
                break
            keyword = self.peek().value
            if keyword == "namespace":
                self.pop()
                scope = self.pop().value
                name = self.pop().value
                if scope in {"go", "js", "py"} and not self.document.namespace:
                    self.document.namespace = name
            elif keyword == "include":
                self.pop()
                include = self.pop().value
                include_path = (self.path.parent / include).resolve()
                alias = Path(include).stem
                self.document.includes[alias] = include_path
            elif keyword == "typedef":
                self.pop()
                type_ref = self.parse_type()
                name = self.pop().value
                self.parse_annotations_if_present()
                self.document.typedefs[name] = TypedefDef(
                    name=name, type_ref=type_ref, comments=pending_comments
                )
                pending_comments = []
                self.consume_delimiters()
            elif keyword == "const":
                self.pop()
                type_ref = self.parse_type()
                name = self.pop().value
                self.pop("=")
                value = self.parse_value()
                self.document.constants.append((type_ref, name, value))
                pending_comments = []
                self.consume_delimiters()
            elif keyword == "enum":
                enum_def = self.parse_enum(pending_comments)
                self.document.enums[enum_def.name] = enum_def
                pending_comments = []
            elif keyword in {"struct", "union", "exception"}:
                struct_def = self.parse_struct(pending_comments)
                self.document.structs[struct_def.name] = struct_def
                pending_comments = []
            elif keyword == "service":
                self.document.services.append(self.parse_service(pending_comments))
                pending_comments = []
            else:
                pending_comments = []
                self.skip_unknown()
            self.consume_delimiters()
        return self.document

    def parse_type(self) -> TypeRef:
        token = self.pop()
        name = token.value
        if self.consume("<"):
            args = [self.parse_type()]
            if self.consume(","):
                args.append(self.parse_type())
            self.pop(">")
            self.parse_annotations_if_present()
            return TypeRef(kind=name, args=args)
        return TypeRef(kind="named", name=name)

    def parse_annotations_if_present(self) -> dict[str, str]:
        if not self.consume("("):
            return {}
        annotations: dict[str, str] = {}
        while self.peek() and not self.peek(")"):
            self.consume_delimiters()
            if self.peek(")"):
                break
            key = self.pop().value
            value = "true"
            if self.consume("="):
                parsed = self.parse_value()
                value = str(parsed).lower() if isinstance(parsed, bool) else str(parsed)
            annotations[key] = value
            self.consume_delimiters()
        self.pop(")")
        return annotations

    def parse_value(self) -> Any:
        token = self.pop()
        if token.value in {"true", "false"}:
            return token.value == "true"
        if token.kind == "NUMBER":
            return float(token.value) if "." in token.value else int(token.value)
        if token.kind == "STRING":
            return token.value
        if token.value == "[":
            values: list[Any] = []
            while self.peek() and not self.peek("]"):
                self.consume_delimiters()
                if not self.peek("]"):
                    values.append(self.parse_value())
                self.consume_delimiters()
            self.pop("]")
            return values
        if token.value == "{":
            values: dict[str, Any] = {}
            while self.peek() and not self.peek("}"):
                self.consume_delimiters()
                if self.peek("}"):
                    break
                key = str(self.parse_value())
                self.consume(":") or self.consume("=")
                values[key] = self.parse_value()
                self.consume_delimiters()
            self.pop("}")
            return values
        return token.value

    def parse_field(self, comments: list[str]) -> Field:
        field_id = int(self.pop().value)
        self.pop(":")
        requiredness = "default"
        if self.peek() and self.peek().value in {"required", "optional"}:
            requiredness = self.pop().value
        type_ref = self.parse_type()
        name = self.pop().value
        default = None
        if self.consume("="):
            default = self.parse_value()
        annotations = self.parse_annotations_if_present()
        self.consume_delimiters()
        return Field(
            field_id=field_id,
            requiredness=requiredness,
            type_ref=type_ref,
            name=name,
            annotations=annotations,
            comments=comments,
            default=default,
        )

    def parse_fields(self, closing: str) -> list[Field]:
        fields: list[Field] = []
        pending_comments: list[str] = []
        while self.peek() and not self.peek(closing):
            self.consume_delimiters()
            pending_comments.extend(self.consume_comments())
            if self.peek(closing):
                break
            token = self.peek()
            if token and token.kind == "NUMBER":
                field_def = self.parse_field(pending_comments)
                end_line = self.tokens[self.pos - 1].line
                while (
                    self.peek()
                    and self.peek().kind in {"LINECOMMENT", "BLOCKCOMMENT"}
                    and self.peek().line == end_line
                ):
                    field_def.comments.append(self.pop().value)
                fields.append(field_def)
                pending_comments = []
            else:
                self.pop()
        self.pop(closing)
        return fields

    def parse_struct(self, comments: list[str]) -> StructDef:
        kind = self.pop().value
        name = self.pop().value
        self.parse_annotations_if_present()
        self.pop("{")
        fields = self.parse_fields("}")
        self.parse_annotations_if_present()
        return StructDef(
            name=name,
            fields=fields,
            comments=comments,
            is_union=kind == "union",
        )

    def parse_enum(self, comments: list[str]) -> EnumDef:
        self.pop("enum")
        name = self.pop().value
        self.parse_annotations_if_present()
        self.pop("{")
        values: list[tuple[str, int]] = []
        next_value = 0
        while self.peek() and not self.peek("}"):
            self.consume_delimiters()
            self.consume_comments()
            if self.peek("}"):
                break
            member = self.pop().value
            value = next_value
            if self.consume("="):
                parsed = self.parse_value()
                value = int(parsed)
            self.parse_annotations_if_present()
            self.consume_delimiters()
            values.append((member, value))
            next_value = value + 1
        self.pop("}")
        self.parse_annotations_if_present()
        return EnumDef(name=name, values=values, comments=comments)

    def parse_service(self, comments: list[str]) -> ServiceDef:
        self.pop("service")
        name = self.pop().value
        if self.consume("extends"):
            self.pop()
        self.parse_annotations_if_present()
        self.pop("{")
        methods: list[Method] = []
        pending_comments: list[str] = []
        while self.peek() and not self.peek("}"):
            self.consume_delimiters()
            pending_comments.extend(self.consume_comments())
            if self.peek("}"):
                break
            try:
                methods.append(self.parse_method(pending_comments))
            except ValueError:
                self.skip_until_service_boundary()
            pending_comments = []
        self.pop("}")
        self.parse_annotations_if_present()
        return ServiceDef(name=name, methods=methods, comments=comments)

    def parse_method(self, comments: list[str]) -> Method:
        self.consume("oneway")
        return_type = self.parse_type()
        name = self.pop().value
        self.pop("(")
        args = self.parse_fields(")")
        if self.consume("throws"):
            self.pop("(")
            self.parse_fields(")")
        annotations = self.parse_annotations_if_present()
        self.consume_delimiters()
        return Method(
            name=name,
            return_type=return_type,
            args=args,
            annotations=annotations,
            comments=comments,
        )

    def skip_until_service_boundary(self) -> None:
        depth = 0
        while self.peek():
            token = self.pop()
            if token.value in {"(", "{", "[", "<"}:
                depth += 1
            elif token.value in {")",
                "}",
                "]",
                ">",
            }:
                if token.value == "}" and depth == 0:
                    self.pos -= 1
                    return
                depth = max(0, depth - 1)
            elif token.value in {",", ";"} and depth == 0:
                return

    def skip_unknown(self) -> None:
        token = self.pop()
        if self.peek("{"):
            self.pop()
            depth = 1
            while self.peek() and depth:
                value = self.pop().value
                if value == "{":
                    depth += 1
                elif value == "}":
                    depth -= 1
        elif token.value in {"cpp_include", "hs_include"} and self.peek():
            self.pop()


class OpenAPIGenerator:
    def __init__(self, idl_root: Path, router_path: Optional[Path] = None):
        self.idl_root = idl_root.resolve()
        self.router_path = router_path.resolve() if router_path else None
        self.documents: dict[Path, Document] = {}
        self.documents_by_namespace: dict[str, list[Document]] = {}
        self.registered_routes: dict[str, tuple[str, str]] = {}
        self.components: dict[str, dict[str, Any]] = {}
        self.building_components: set[str] = set()
        self.warnings: set[str] = set()
        self.typedef_values: dict[tuple[Path, str], list[Any]] = {}

    def load(self) -> None:
        for path in sorted(self.idl_root.rglob("*.thrift")):
            document = ThriftParser(path, self.idl_root).parse()
            self.documents[path.resolve()] = document
            if document.namespace:
                self.documents_by_namespace.setdefault(document.namespace, []).append(
                    document
                )
        if self.router_path:
            self.registered_routes = self._load_registered_routes(self.router_path)
        self._index_typedef_constants()

    def _load_registered_routes(self, router_path: Path) -> dict[str, tuple[str, str]]:
        """Read the generated Hertz router so docs only expose runnable routes."""
        text = router_path.read_text(encoding="utf-8")
        group_paths: dict[str, str] = {"r": ""}
        routes: dict[str, tuple[str, str]] = {}
        group_pattern = re.compile(
            r'^\s*([A-Za-z_]\w*)\s*:=\s*([A-Za-z_]\w*)\.Group\("([^"]*)"'
        )
        route_pattern = re.compile(
            r'^\s*([A-Za-z_]\w*)\.(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)'
            r'\("([^"]*)".*?apis\.([A-Za-z_]\w*)'
        )
        for line in text.splitlines():
            group_match = group_pattern.search(line)
            if group_match:
                variable, parent, suffix = group_match.groups()
                if parent not in group_paths:
                    raise ValueError(
                        f"unknown Hertz route group {parent!r} in {router_path}"
                    )
                group_paths[variable] = self._join_route(
                    group_paths[parent], suffix
                )
                continue
            route_match = route_pattern.search(line)
            if not route_match:
                continue
            group, verb, suffix, handler = route_match.groups()
            if group not in group_paths:
                raise ValueError(
                    f"unknown Hertz route group {group!r} in {router_path}"
                )
            route = (verb.lower(), self._join_route(group_paths[group], suffix))
            if handler in routes and routes[handler] != route:
                raise ValueError(
                    f"handler {handler} is registered more than once in {router_path}"
                )
            routes[handler] = route
        if not routes:
            raise ValueError(f"no Hertz routes found in {router_path}")
        return routes

    @staticmethod
    def _join_route(prefix: str, suffix: str) -> str:
        parts = [part.strip("/") for part in (prefix, suffix) if part.strip("/")]
        return "/" + "/".join(parts) if parts else "/"

    def _index_typedef_constants(self) -> None:
        for path, document in self.documents.items():
            for type_ref, _, value in document.constants:
                if type_ref.kind != "named" or type_ref.name not in document.typedefs:
                    continue
                self.typedef_values.setdefault((path, type_ref.name), []).append(value)

    def generate(self) -> dict[str, Any]:
        self.load()
        paths: dict[str, dict[str, Any]] = {}
        tags: set[str] = set()
        operation_ids: set[str] = set()
        endpoint_count = 0
        for path, document in sorted(self.documents.items(), key=lambda item: str(item[0])):
            for service in document.services:
                for method in service.methods:
                    http = self.http_binding(method)
                    if not http:
                        continue
                    if self.registered_routes:
                        registered = self.registered_routes.get(method.name)
                        if not registered:
                            continue
                        verb, raw_path = registered
                    else:
                        verb, raw_path = http
                    api_path = re.sub(r":([A-Za-z_][A-Za-z0-9_]*)", r"{\1}", raw_path)
                    operation = self.build_operation(document, service, method, verb, api_path)
                    operation_id = operation["operationId"]
                    if operation_id in operation_ids:
                        operation["operationId"] = f"{service.name}_{operation_id}"
                    operation_ids.add(operation["operationId"])
                    if verb in paths.setdefault(api_path, {}):
                        self.warnings.add(f"duplicate route {verb.upper()} {api_path}")
                        continue
                    paths[api_path][verb] = operation
                    tags.update(operation["tags"])
                    endpoint_count += 1

        ordered_paths = {
            path: {verb: methods[verb] for verb in sorted(methods)}
            for path, methods in sorted(paths.items())
        }
        document = {
            "openapi": "3.0.3",
            "info": {
                "title": "GCS Loop Backend API",
                "version": "1.0.0",
                "description": (
                    "Generated from backend Thrift IDL. Business errors are returned "
                    "with HTTP 200 and a non-zero `code`. Do not edit this file manually."
                ),
            },
            "servers": [{"url": "/", "description": "Current GCS Loop server"}],
            "tags": [{"name": tag} for tag in sorted(tags)],
            "paths": ordered_paths,
            "components": {
                "securitySchemes": {
                    "sessionCookie": {
                        "type": "apiKey",
                        "in": "cookie",
                        "name": "session_key",
                        "description": "Session cookie returned by the login API.",
                    },
                    "bearerAuth": {
                        "type": "http",
                        "scheme": "bearer",
                        "description": "Personal access token for `/v1/loop/**` APIs.",
                    },
                },
                "schemas": {key: self.components[key] for key in sorted(self.components)},
            },
            "x-generated-endpoint-count": endpoint_count,
        }
        return document

    @staticmethod
    def http_binding(method: Method) -> Optional[tuple[str, str]]:
        for annotation, verb in HTTP_ANNOTATIONS.items():
            if annotation in method.annotations:
                return verb, method.annotations[annotation]
        return None

    def build_operation(
        self,
        document: Document,
        service: ServiceDef,
        method: Method,
        verb: str,
        api_path: str,
    ) -> dict[str, Any]:
        module = self.module_tag(document.path)
        category = method.annotations.get("api.category", "").strip()
        tags = [category or module]
        description = comment_text(method.comments)
        summary = self.summary(description, method.name)
        operation: dict[str, Any] = {
            "tags": tags,
            "summary": summary,
            "operationId": method.name,
            "responses": self.build_responses(document, method, api_path),
        }
        if description and description != summary:
            operation["description"] = description
        if method.annotations.get("streaming.mode") == "server":
            stream_note = "Server-streaming response (`text/event-stream`)."
            operation["description"] = "\n\n".join(
                part for part in [operation.get("description", ""), stream_note] if part
            )
            operation["x-streaming-mode"] = "server"

        request_struct = self.resolve_struct(document, self.request_type(method))
        if request_struct:
            request_doc, request_def = request_struct
            parameters, request_body = self.build_request(
                request_doc, request_def, verb, api_path
            )
            if parameters:
                operation["parameters"] = parameters
            if request_body:
                operation["requestBody"] = request_body

        if api_path in PUBLIC_SESSION_PATHS:
            operation["security"] = []
        elif api_path.startswith("/v1/"):
            operation["security"] = [{"bearerAuth": []}]
        elif api_path.startswith("/api/"):
            operation["security"] = [{"sessionCookie": []}]
        return operation

    def build_request(
        self, document: Document, struct_def: StructDef, verb: str, api_path: str
    ) -> tuple[list[dict[str, Any]], Optional[dict[str, Any]]]:
        parameters: list[dict[str, Any]] = []
        body_properties: dict[str, Any] = {}
        body_required: list[str] = []
        form_properties: dict[str, Any] = {}
        form_required: list[str] = []
        raw_body: Optional[dict[str, Any]] = None
        placeholders = set(re.findall(r"{([^}]+)}", api_path))

        for field_def in struct_def.fields:
            if self.is_internal_field(document, field_def):
                continue
            binding, binding_name = self.field_binding(field_def)
            name = binding_name or self.json_name(field_def)
            required = self.is_required(field_def)
            schema = self.schema_for_field(document, field_def)
            description = comment_text(field_def.comments)

            if binding is None and name in placeholders:
                binding = "path"
            elif binding == "path" and name not in placeholders:
                # A few upstream IDLs retained stale api.path annotations after
                # their routes moved. Hertz still exposes their JSON tags on
                # body methods, while OpenAPI forbids undeclared path params.
                binding = None
            if binding in {"path", "query", "header", "cookie"}:
                parameter: dict[str, Any] = {
                    "name": name,
                    "in": binding,
                    "required": binding == "path" or required,
                    "schema": schema,
                }
                if description:
                    parameter["description"] = description
                if binding == "query" and schema.get("type") == "object":
                    parameter["style"] = "deepObject"
                    parameter["explode"] = True
                parameters.append(parameter)
            elif binding == "raw_body":
                raw_body = schema
            elif binding == "form":
                form_properties[name] = schema
                if required:
                    form_required.append(name)
            elif binding == "body" or (binding is None and verb in BODY_METHODS):
                body_properties[name] = schema
                if description:
                    body_properties[name] = {**schema, "description": description}
                if required:
                    body_required.append(name)
            elif binding is None and verb not in BODY_METHODS:
                parameter = {
                    "name": name,
                    "in": "query",
                    "required": required,
                    "schema": schema,
                }
                if description:
                    parameter["description"] = description
                if schema.get("type") == "object":
                    parameter["style"] = "deepObject"
                    parameter["explode"] = True
                parameters.append(parameter)

        declared_path_parameters = {
            parameter["name"]
            for parameter in parameters
            if parameter["in"] == "path"
        }
        for placeholder in sorted(placeholders - declared_path_parameters):
            parameters.append(
                {
                    "name": placeholder,
                    "in": "path",
                    "required": True,
                    "schema": {"type": "string"},
                    "description": (
                        "Route parameter not represented in the Thrift request struct."
                    ),
                }
            )

        parameters.sort(key=lambda item: (item["in"], item["name"]))
        if raw_body is not None:
            raw_schema = dict(raw_body)
            if raw_schema.get("format") == "byte":
                raw_schema["format"] = "binary"
            media_types = RAW_BODY_MEDIA_TYPES.get(
                api_path, ("application/octet-stream",)
            )
            content = {}
            for media_type in media_types:
                media_schema = raw_schema
                if (
                    api_path == "/v1/loop/opentelemetry/v1/traces"
                    and media_type == "application/json"
                ):
                    media_schema = {"type": "object", "additionalProperties": True}
                content[media_type] = {"schema": media_schema}
            return parameters, {
                "required": True,
                "description": "Raw request bytes; set Content-Type to the actual payload media type.",
                "content": content,
            }
        if form_properties:
            schema: dict[str, Any] = {
                "type": "object",
                "properties": form_properties,
            }
            if form_required:
                schema["required"] = sorted(form_required)
            return parameters, {
                "required": bool(form_required),
                "content": {"multipart/form-data": {"schema": schema}},
            }
        if body_properties:
            schema = {"type": "object", "properties": body_properties}
            if body_required:
                schema["required"] = sorted(body_required)
            return parameters, {
                "required": bool(body_required),
                "content": {"application/json": {"schema": schema}},
            }
        return parameters, None

    def build_responses(
        self, document: Document, method: Method, api_path: str
    ) -> dict[str, Any]:
        is_stream = method.annotations.get("streaming.mode") == "server"
        schema = (
            self.streaming_event_schema(document, method)
            if is_stream
            else self.schema_for_type(document, method.return_type)
        )
        raw_media_types = RAW_RESPONSE_MEDIA_TYPES.get(api_path)
        if raw_media_types:
            content = {
                media_type: {
                    "schema": {"type": "string", "format": "binary"}
                }
                for media_type in raw_media_types
            }
            content["application/json"] = {
                "schema": {
                    "type": "object",
                    "required": ["code", "msg"],
                    "properties": {
                        "code": {"type": "integer", "format": "int32"},
                        "msg": {"type": "string"},
                    },
                }
            }
            responses: dict[str, Any] = {
                "200": {
                    "description": "Raw success payload, or JSON business error",
                    "content": content,
                }
            }
        else:
            content_type = "text/event-stream" if is_stream else "application/json"
            media: dict[str, Any] = {"schema": schema}
            if is_stream:
                media["x-sse-event-description"] = (
                    "SSE `data` events contain JSON matching this schema; `error` "
                    "events contain `code`, `msg`, and `biz_extra`."
                )
            responses = {
                "200": {
                    "description": (
                        "Streaming response"
                        if is_stream
                        else "Success, or business error when `code` is non-zero"
                    ),
                    "content": {content_type: media},
                }
            }
        if method.name in DIRECT_BAD_REQUEST_METHODS:
            responses["400"] = {
                "description": "Invalid request binding or validation",
                "content": {"text/plain": {"schema": {"type": "string"}}},
            }
        return responses

    def streaming_event_schema(
        self, document: Document, method: Method
    ) -> dict[str, Any]:
        if method.name != "ExecuteStreaming":
            return self.schema_for_type(document, method.return_type)
        response_struct = self.resolve_struct(document, method.return_type)
        if not response_struct:
            return self.schema_for_type(document, method.return_type)
        response_doc, response_def = response_struct
        for field_def in response_def.fields:
            if self.json_name(field_def) == "data":
                return self.schema_for_field(response_doc, field_def)
        return self.schema_for_type(document, method.return_type)

    def schema_for_field(self, document: Document, field_def: Field) -> dict[str, Any]:
        schema = self.schema_for_type(document, field_def.type_ref)
        if field_def.type_ref.kind == "named" and field_def.type_ref.name == "i64":
            if field_def.annotations.get("api.js_conv", "").lower() == "true":
                schema = {"type": "string", "pattern": "^-?\\d+$"}
        if field_def.default is not None and isinstance(
            field_def.default, (str, int, float, bool)
        ):
            schema = {**schema, "default": field_def.default}
        return self.apply_validation(schema, field_def.annotations)

    def schema_for_type(self, document: Document, type_ref: TypeRef) -> dict[str, Any]:
        if type_ref.kind == "named":
            if type_ref.name in PRIMITIVES:
                return dict(PRIMITIVES[type_ref.name])
            resolved = self.resolve_named(document, type_ref.name)
            if not resolved:
                self.warnings.add(
                    f"unresolved type {type_ref.name} referenced from {document.path}"
                )
                return {"type": "object", "x-thrift-type": type_ref.name}
            target_doc, kind, definition = resolved
            if kind == "typedef":
                schema = self.schema_for_type(target_doc, definition.type_ref)
                values = self.typedef_values.get((target_doc.path, definition.name), [])
                if values:
                    schema = {**schema, "enum": values}
                description = comment_text(definition.comments)
                if description:
                    schema = {**schema, "description": description}
                return schema
            component = self.ensure_component(target_doc, kind, definition)
            return {"$ref": f"#/components/schemas/{component}"}
        if type_ref.kind in {"list", "set", "stream"}:
            item = type_ref.args[0] if type_ref.args else TypeRef("named", "string")
            return {"type": "array", "items": self.schema_for_type(document, item)}
        if type_ref.kind == "map":
            value = type_ref.args[-1] if type_ref.args else TypeRef("named", "string")
            return {
                "type": "object",
                "additionalProperties": self.schema_for_type(document, value),
            }
        self.warnings.add(f"unsupported thrift type {type_ref.kind}")
        return {"type": "object", "x-thrift-type": type_ref.kind}

    def ensure_component(self, document: Document, kind: str, definition: Any) -> str:
        key = self.component_key(document, definition.name)
        if key in self.components and key not in self.building_components:
            return key
        if key in self.building_components:
            return key
        self.building_components.add(key)
        self.components[key] = {}
        if kind == "enum":
            schema: dict[str, Any] = {
                "type": "integer",
                "enum": [value for _, value in definition.values],
                "x-enum-varnames": [name for name, _ in definition.values],
            }
            description = comment_text(definition.comments)
            if description:
                schema["description"] = description
        else:
            properties: dict[str, Any] = {}
            required: list[str] = []
            for field_def in definition.fields:
                if self.is_internal_field(document, field_def):
                    continue
                name = self.json_name(field_def)
                if name == "-":
                    continue
                field_schema = self.schema_for_field(document, field_def)
                description = comment_text(field_def.comments)
                if description:
                    field_schema = {**field_schema, "description": description}
                properties[name] = field_schema
                if self.is_required(field_def):
                    required.append(name)
            if (
                definition.name.endswith("Response")
                and definition.name not in STREAMING_RESPONSE_TYPES
            ):
                properties.setdefault(
                    "code",
                    {
                        "type": "integer",
                        "format": "int32",
                        "description": "0 means success; non-zero means a business error.",
                    },
                )
                properties.setdefault("msg", {"type": "string"})
                properties.setdefault(
                    "extra",
                    {
                        "type": "object",
                        "additionalProperties": {"type": "string"},
                        "description": (
                            "Structured context returned for selected business errors. "
                            "It is omitted on success and when an error has no public context."
                        ),
                    },
                )
                required.extend(name for name in ("code", "msg") if name not in required)
            schema = {"type": "object", "properties": properties}
            if required:
                schema["required"] = sorted(set(required))
            if definition.is_union:
                schema["maxProperties"] = 1
            description = comment_text(definition.comments)
            if description:
                schema["description"] = description
        self.components[key] = schema
        self.building_components.remove(key)
        return key

    def resolve_named(
        self, document: Document, name: str
    ) -> Optional[tuple[Document, str, Any]]:
        target_doc = document
        local_name = name
        if "." in name:
            alias, local_name = name.split(".", 1)
            include_path = document.includes.get(alias)
            if include_path:
                target_doc = self.documents.get(include_path.resolve())  # type: ignore[assignment]
                if not target_doc:
                    return None
            else:
                namespace_match: Optional[tuple[Document, str]] = None
                for namespace in sorted(
                    self.documents_by_namespace, key=len, reverse=True
                ):
                    prefix = f"{namespace}."
                    if not name.startswith(prefix):
                        continue
                    candidate_name = name[len(prefix) :]
                    for candidate_doc in self.documents_by_namespace[namespace]:
                        if (
                            candidate_name in candidate_doc.structs
                            or candidate_name in candidate_doc.enums
                            or candidate_name in candidate_doc.typedefs
                        ):
                            namespace_match = (candidate_doc, candidate_name)
                            break
                    if namespace_match:
                        break
                if not namespace_match:
                    return None
                target_doc, local_name = namespace_match
        if local_name in target_doc.structs:
            return target_doc, "struct", target_doc.structs[local_name]
        if local_name in target_doc.enums:
            return target_doc, "enum", target_doc.enums[local_name]
        if local_name in target_doc.typedefs:
            return target_doc, "typedef", target_doc.typedefs[local_name]
        return None

    def resolve_struct(
        self, document: Document, type_ref: Optional[TypeRef]
    ) -> Optional[tuple[Document, StructDef]]:
        if not type_ref or type_ref.kind != "named":
            return None
        resolved = self.resolve_named(document, type_ref.name)
        if not resolved or resolved[1] != "struct":
            return None
        return resolved[0], resolved[2]

    @staticmethod
    def request_type(method: Method) -> Optional[TypeRef]:
        return method.args[0].type_ref if method.args else None

    @staticmethod
    def field_binding(field_def: Field) -> tuple[Optional[str], Optional[str]]:
        if field_def.annotations.get("agw.source") == "raw_body":
            return "raw_body", None
        for binding in ("path", "query", "header", "cookie", "body", "form", "raw_body"):
            value = field_def.annotations.get(f"api.{binding}")
            if value is None:
                continue
            return binding, value.split(",", 1)[0]
        return None, None

    @staticmethod
    def json_name(field_def: Field) -> str:
        tag = field_def.annotations.get("go.tag", "")
        match = re.search(r'json:["\\\']([^,"\\\']+)', tag)
        return match.group(1) if match else field_def.name

    def is_internal_field(self, document: Document, field_def: Field) -> bool:
        if field_def.annotations.get("api.none", "").lower() == "true":
            return True
        if field_def.name.lower() in {"base", "base_resp"}:
            return True
        if field_def.type_ref.kind != "named":
            return False
        resolved = self.resolve_named(document, field_def.type_ref.name)
        return bool(
            resolved
            and resolved[0].namespace == "base"
            and resolved[2].name in {"Base", "BaseResp"}
        )

    @staticmethod
    def is_required(field_def: Field) -> bool:
        return field_def.requiredness == "required" or field_def.annotations.get(
            "vt.not_nil", ""
        ).lower() == "true"

    @staticmethod
    def apply_validation(
        schema: dict[str, Any], annotations: dict[str, str]
    ) -> dict[str, Any]:
        result = dict(schema)
        is_collection = result.get("type") in {"array", "object"}
        is_string = result.get("type") == "string"
        if "vt.min_size" in annotations:
            key = "minItems" if is_collection else "minLength" if is_string else None
            if key:
                result[key] = int(float(annotations["vt.min_size"]))
        if "vt.max_size" in annotations:
            key = "maxItems" if is_collection else "maxLength" if is_string else None
            if key:
                result[key] = int(float(annotations["vt.max_size"]))
        if result.get("type") in {"integer", "number"}:
            if "vt.gt" in annotations:
                result["minimum"] = OpenAPIGenerator.numeric_value(
                    annotations["vt.gt"]
                )
                result["exclusiveMinimum"] = True
            elif "vt.ge" in annotations:
                result["minimum"] = OpenAPIGenerator.numeric_value(
                    annotations["vt.ge"]
                )
            if "vt.lt" in annotations:
                result["maximum"] = OpenAPIGenerator.numeric_value(
                    annotations["vt.lt"]
                )
                result["exclusiveMaximum"] = True
            elif "vt.le" in annotations:
                result["maximum"] = OpenAPIGenerator.numeric_value(
                    annotations["vt.le"]
                )
        return result

    @staticmethod
    def numeric_value(raw: str) -> int | float:
        value = float(raw)
        return int(value) if value.is_integer() else value

    @staticmethod
    def summary(description: str, fallback: str) -> str:
        if not description:
            return fallback
        for line in description.splitlines():
            candidate = line.strip().strip("-/")
            if candidate:
                return candidate[:120]
        return fallback

    def component_key(self, document: Document, name: str) -> str:
        namespace = document.namespace or str(document.path.relative_to(self.idl_root))
        return re.sub(r"[^A-Za-z0-9_.-]", "_", f"{namespace}.{name}")

    def module_tag(self, path: Path) -> str:
        try:
            parts = path.relative_to(self.idl_root / "coze" / "loop").parts
        except ValueError:
            return "common"
        return parts[0] if len(parts) > 1 else "common"


def render_document(generator: OpenAPIGenerator) -> tuple[str, dict[str, Any]]:
    document = generator.generate()
    content = json.dumps(document, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    return content, document


def parse_args() -> argparse.Namespace:
    repo_root = Path(__file__).resolve().parents[3]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--idl-root",
        type=Path,
        default=repo_root / "idl" / "thrift",
        help="Thrift root directory",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=repo_root / "backend" / "api" / "apidocs" / "openapi.json",
        help="Generated OpenAPI JSON path",
    )
    parser.add_argument(
        "--router",
        type=Path,
        default=(
            repo_root
            / "backend"
            / "api"
            / "router"
            / "coze"
            / "loop"
            / "apis"
            / "coze.loop.apis.go"
        ),
        help="Generated Hertz router used to filter and resolve actual HTTP routes",
    )
    parser.add_argument(
        "--check",
        action="store_true",
        help="Fail when the committed OpenAPI document is stale",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    generator = OpenAPIGenerator(args.idl_root, args.router)
    try:
        content, document = render_document(generator)
    except (OSError, ValueError) as exc:
        print(f"openapi generation failed: {exc}", file=sys.stderr)
        return 1

    output = args.output.resolve()
    if args.check:
        if not output.exists() or output.read_text(encoding="utf-8") != content:
            print(
                f"{output} is stale; run backend/script/openapi/generate.py",
                file=sys.stderr,
            )
            return 1
    else:
        output.parent.mkdir(parents=True, exist_ok=True)
        # pathlib.Path.write_text only gained the newline argument in newer
        # Python releases. Keep the deployment generator compatible with the
        # Python 3.8/3.9 commonly bundled on Docker Compose hosts.
        with output.open("w", encoding="utf-8", newline="\n") as output_file:
            output_file.write(content)

    print(
        "generated "
        f"{document['x-generated-endpoint-count']} endpoints and "
        f"{len(document['components']['schemas'])} schemas -> {output}"
    )
    if generator.warnings:
        print(f"warnings: {len(generator.warnings)}", file=sys.stderr)
        for warning in sorted(generator.warnings)[:20]:
            print(f"  - {warning}", file=sys.stderr)
        if len(generator.warnings) > 20:
            print("  - ...", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
