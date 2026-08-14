#!/usr/bin/env python3
"""Regression tests for the backend OpenAPI generator."""

from __future__ import annotations

import unittest
from pathlib import Path

from generate import OpenAPIGenerator


REPO_ROOT = Path(__file__).resolve().parents[3]
IDL_ROOT = REPO_ROOT / "idl" / "thrift"
ROUTER = (
    REPO_ROOT
    / "backend"
    / "api"
    / "router"
    / "coze"
    / "loop"
    / "apis"
    / "coze.loop.apis.go"
)


class OpenAPIGeneratorTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.generator = OpenAPIGenerator(IDL_ROOT, ROUTER)
        cls.document = cls.generator.generate()

    def test_paths_match_registered_hertz_routes(self) -> None:
        expected = {
            (verb, self._openapi_path(path))
            for verb, path in self.generator.registered_routes.values()
        }
        actual = {
            (verb, path)
            for path, operations in self.document["paths"].items()
            for verb in operations
        }
        self.assertSetEqual(actual, expected)
        self.assertEqual(
            len(actual), self.document["x-generated-endpoint-count"]
        )

    def test_prompt_request_binding_and_session_auth(self) -> None:
        get_prompt = self.document["paths"][
            "/api/prompt/v1/prompts/{prompt_id}"
        ]["get"]
        parameters = {
            (parameter["in"], parameter["name"])
            for parameter in get_prompt["parameters"]
        }
        self.assertIn(("path", "prompt_id"), parameters)
        self.assertIn(("query", "workspace_id"), parameters)
        self.assertEqual(get_prompt["security"], [{"sessionCookie": []}])

        save_draft = self.document["paths"][
            "/api/prompt/v1/prompts/{prompt_id}/drafts/save"
        ]["post"]
        body_schema = save_draft["requestBody"]["content"]["application/json"][
            "schema"
        ]
        self.assertIn("prompt_draft", body_schema["properties"])
        self.assertNotIn("Base", body_schema["properties"])

        invoke_info = self.document["paths"][
            "/api/prompt/v1/prompts/{prompt_id}/commits/{commit_version}/invoke_info"
        ]["get"]
        invoke_parameters = {
            (parameter["in"], parameter["name"]): parameter
            for parameter in invoke_info["parameters"]
        }
        self.assertTrue(invoke_parameters[("path", "prompt_id")]["required"])
        self.assertTrue(
            invoke_parameters[("path", "commit_version")]["required"]
        )
        self.assertTrue(
            invoke_parameters[("query", "workspace_id")]["required"]
        )
        self.assertEqual(invoke_info["security"], [{"sessionCookie": []}])

        invoke_schema = self.document["components"]["schemas"][
            "coze.loop.prompt.manage.PromptInvokeInfo"
        ]
        self.assertEqual(
            invoke_schema["properties"]["base_url"]["type"], "string"
        )
        self.assertNotIn("base_url", invoke_schema.get("required", []))

    def test_prompt_execute_response_has_trace_and_resolved_version(self) -> None:
        for path in (
            "/v1/loop/prompts/execute",
            "/v1/loop/prompts/execute_streaming",
        ):
            request_body = self.document["paths"][path]["post"]["requestBody"]
            self.assertTrue(request_body["required"])
            request_schema = request_body["content"]["application/json"][
                "schema"
            ]
            self.assertSetEqual(
                set(request_schema["required"]),
                {"workspace_id", "prompt_identifier"},
            )

        prompt_query = self.document["components"]["schemas"][
            "coze.loop.prompt.domain_openapi.prompt.PromptQuery"
        ]
        self.assertIn("prompt_key", prompt_query["required"])

        for schema_name in (
            "coze.loop.prompt.domain_openapi.prompt.ExecuteData",
            "coze.loop.prompt.domain_openapi.prompt.ExecuteStreamingData",
        ):
            properties = self.document["components"]["schemas"][schema_name][
                "properties"
            ]
            self.assertTrue(
                {"trace_id", "prompt_key", "resolved_version"}.issubset(
                    properties
                )
            )

    def test_evaluation_prompt_optimization_contract(self) -> None:
        prefix = "/api/evaluation/v1/experiments/{expt_id}/prompt_optimizations"
        expected = {
            ("get", f"{prefix}/prepare"),
            ("post", prefix),
            ("post", f"{prefix}/list"),
            ("get", f"{prefix}/{{optimization_id}}"),
            ("post", f"{prefix}/{{optimization_id}}/cancel"),
            ("post", f"{prefix}/{{optimization_id}}/apply_to_draft"),
        }
        for method, path in expected:
            operation = self.document["paths"][path][method]
            self.assertEqual(operation["security"], [{"sessionCookie": []}])

        create = self.document["paths"][prefix]["post"]
        create_schema = create["requestBody"]["content"]["application/json"][
            "schema"
        ]
        self.assertTrue(
            {"workspace_id", "samples", "variable_mappings"}.issubset(
                create_schema["required"]
            )
        )
        self.assertEqual(
            create_schema["properties"]["samples"]["maxItems"], 20
        )

        apply_path = f"{prefix}/{{optimization_id}}/apply_to_draft"
        apply_schema = self.document["paths"][apply_path]["post"][
            "requestBody"
        ]["content"]["application/json"]["schema"]
        self.assertIn("overwrite_existing_draft", apply_schema["properties"])

        task_schema = self.document["components"]["schemas"][
            "coze.loop.evaluation.expt.PromptOptimizationTask"
        ]
        self.assertTrue(
            {
                "status",
                "stage",
                "progress",
                "baseline_metrics",
                "best_metrics",
                "original_prompt_template",
                "optimized_prompt_template",
                "iterations",
                "applied_to_draft",
            }.issubset(task_schema["properties"])
        )

    def test_unannotated_body_field_is_documented_in_json_body(self) -> None:
        list_datasets = self.document["paths"]["/api/data/v1/datasets/list"][
            "post"
        ]
        path_parameters = {
            parameter["name"]
            for parameter in list_datasets.get("parameters", [])
            if parameter["in"] == "path"
        }
        self.assertNotIn("workspace_id", path_parameters)
        body_properties = list_datasets["requestBody"]["content"][
            "application/json"
        ]["schema"]["properties"]
        self.assertIn("workspace_id", body_properties)

    def test_missing_thrift_path_field_is_synthesized(self) -> None:
        debug_streaming = self.document["paths"][
            "/api/prompt/v1/prompts/{prompt_id}/debug_streaming"
        ]["post"]
        path_parameters = {
            parameter["name"]
            for parameter in debug_streaming["parameters"]
            if parameter["in"] == "path"
        }
        self.assertIn("prompt_id", path_parameters)
        self.assertIn("400", debug_streaming["responses"])

    def test_unannotated_get_fields_follow_hertz_query_binding(self) -> None:
        get_tag_spec = self.document["paths"]["/api/data/v1/tag_spec"]["get"]
        parameters = {
            (parameter["in"], parameter["name"]): parameter
            for parameter in get_tag_spec["parameters"]
        }
        self.assertIn(("query", "workspace_id"), parameters)
        self.assertTrue(parameters[("query", "workspace_id")]["required"])

        source_version = self.document["paths"][
            "/api/evaluation/v1/eval_targets/get_source_version"
        ]["get"]
        query_names = {
            parameter["name"]
            for parameter in source_version["parameters"]
            if parameter["in"] == "query"
        }
        self.assertTrue(
            {
                "workspace_id",
                "source_target_id",
                "source_target_version",
                "target_type",
                "shared_option",
            }.issubset(query_names)
        )

    def test_response_envelope_and_openapi_auth(self) -> None:
        response = self.document["components"]["schemas"][
            "coze.loop.prompt.manage.SaveDraftResponse"
        ]
        self.assertIn("code", response["properties"])
        self.assertIn("msg", response["properties"])
        self.assertEqual(
            response["properties"]["extra"]["additionalProperties"],
            {"type": "string"},
        )
        self.assertNotIn("extra", response["required"])

        list_commit = self.document["paths"][
            "/api/prompt/v1/prompts/{prompt_id}/commits/list"
        ]["post"]
        list_commit_body = list_commit["requestBody"]["content"][
            "application/json"
        ]["schema"]
        self.assertEqual(
            list_commit_body["properties"]["page_size"]["maximum"], 200
        )

        get_prompt = self.document["paths"]["/v1/loop/prompts/{prompt_id}"][
            "get"
        ]
        self.assertEqual(get_prompt["security"], [{"bearerAuth": []}])

        reset_password = self.document["paths"][
            "/api/foundation/v1/users/reset_password"
        ]["post"]
        self.assertEqual(reset_password["security"], [{"sessionCookie": []}])

        public_api_config = self.document["paths"][
            "/api/auth/v1/public_api_config"
        ]["get"]
        self.assertEqual(
            public_api_config["security"], [{"sessionCookie": []}]
        )
        public_api_config_schema = self.document["components"]["schemas"][
            "coze.loop.foundation.authn.GetPublicAPIConfigResponse"
        ]
        self.assertEqual(
            public_api_config_schema["properties"]["base_url"]["type"],
            "string",
        )

        logout = self.document["paths"]["/api/foundation/v1/users/logout"][
            "post"
        ]
        self.assertNotIn("parameters", logout)

    def test_raw_binary_and_streaming_contracts(self) -> None:
        upload = self.document["paths"]["/v1/loop/files/upload"]["post"]
        upload_schema = upload["requestBody"]["content"][
            "application/octet-stream"
        ]["schema"]
        self.assertEqual(upload_schema, {"type": "string", "format": "binary"})

        otel = self.document["paths"][
            "/v1/loop/opentelemetry/v1/traces"
        ]["post"]
        self.assertSetEqual(
            set(otel["requestBody"]["content"]),
            {"application/x-protobuf", "application/json"},
        )
        self.assertIn(
            "application/x-protobuf", otel["responses"]["200"]["content"]
        )
        self.assertEqual(
            otel["requestBody"]["content"]["application/json"]["schema"],
            {"type": "object", "additionalProperties": True},
        )
        otel_headers = {
            parameter["name"]: parameter for parameter in otel["parameters"]
        }
        self.assertFalse(otel_headers["Content-Encoding"]["required"])

        execute_streaming = self.document["paths"][
            "/v1/loop/prompts/execute_streaming"
        ]["post"]
        event_schema = execute_streaming["responses"]["200"]["content"][
            "text/event-stream"
        ]["schema"]
        self.assertTrue(event_schema["$ref"].endswith(".ExecuteStreamingData"))
        self.assertIn(
            "x-sse-event-description",
            execute_streaming["responses"]["200"]["content"][
                "text/event-stream"
            ],
        )

        debug_response = self.document["components"]["schemas"][
            "coze.loop.prompt.debug.DebugStreamingResponse"
        ]
        self.assertNotIn("code", debug_response["properties"])
        self.assertNotIn("msg", debug_response["properties"])

    def test_regular_binding_errors_remain_business_responses(self) -> None:
        save_draft = self.document["paths"][
            "/api/prompt/v1/prompts/{prompt_id}/drafts/save"
        ]["post"]
        self.assertNotIn("400", save_draft["responses"])

    def test_inline_field_comments_stay_with_their_fields(self) -> None:
        execute = self.document["paths"]["/v1/loop/prompts/execute"]["post"]
        properties = execute["requestBody"]["content"]["application/json"][
            "schema"
        ]["properties"]
        self.assertEqual(properties["prompt_identifier"]["description"], "Prompt 标识")
        self.assertEqual(properties["variable_vals"]["description"], "变量值")

    def test_all_referenced_types_are_resolved(self) -> None:
        self.assertSetEqual(self.generator.warnings, set())

    @staticmethod
    def _openapi_path(path: str) -> str:
        import re

        return re.sub(r":([A-Za-z_][A-Za-z0-9_]*)", r"{\1}", path)


if __name__ == "__main__":
    unittest.main()
