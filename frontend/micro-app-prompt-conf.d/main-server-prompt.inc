# CozeLoop prompt micro-app — same origin as main app, deployed under /prompt
# Static root: /root/FrontendFiles/micro-app-prompt (frontend build output)

location = /prompt {
        return 301 /prompt/;
}

# 静态资源分层缓存（须在通用 /prompt/ location 之前 include）
include micro-app-prompt-conf.d/prompt-static-cache.inc;

# SPA 路由与其它静态文件；未命中文件回落 index.html。
location ^~ /prompt/ {
        include micro-app-prompt-conf.d/prompt-location-gzip.inc;
        alias /root/FrontendFiles/micro-app-prompt/;
        try_files $uri $uri/ /prompt/index.html;
        add_header Cache-Control "no-cache, must-revalidate";
}

# CozeLoop API：前端构建时 API_SCHEMA_BASE_URL=/promptApi。
# proxy_pass 末尾的 / 会移除 /promptApi/ 前缀。
location ^~ /promptApi/ {
        proxy_pass http://172.18.127.43:8082/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $host;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_cookie_domain off;
        proxy_cookie_path / /;
}
