# prompt 微应用预压缩资源支持
gzip_static on;
gzip on;
gzip_vary on;
gzip_min_length 1024;
gzip_comp_level 6;
gzip_types
        application/javascript
        application/json
        application/xml
        image/svg+xml
        text/css
        text/javascript
        text/plain;
