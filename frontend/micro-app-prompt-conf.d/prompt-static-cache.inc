# CozeLoop prompt 微应用静态资源缓存
# 部署路径：/prompt/ → /root/FrontendFiles/micro-app-prompt/

# Rsbuild 生成的静态资源带内容 hash，可长期缓存。
location ^~ /prompt/static/ {
        include micro-app-prompt-conf.d/prompt-location-gzip.inc;
        alias /root/FrontendFiles/micro-app-prompt/static/;
        add_header Cache-Control "public, max-age=31536000, immutable" always;
        access_log off;
}

# SPA 入口必须禁用缓存，避免发版后继续引用旧 chunk。
location = /prompt/index.html {
        include micro-app-prompt-conf.d/prompt-location-gzip.inc;
        alias /root/FrontendFiles/micro-app-prompt/index.html;
        add_header Cache-Control "no-cache, must-revalidate" always;
}
