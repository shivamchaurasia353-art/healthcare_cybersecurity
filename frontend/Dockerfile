FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json ./
RUN npm install
COPY . .
RUN npm run build

FROM nginx:alpine AS runner
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/templates/default.conf.template
EXPOSE 80
# nginx entrypoint image handles envsubst automatically for /etc/nginx/templates/
# Set a fallback resolver; runtime entrypoint overrides via RESOLVER env var
CMD ["/bin/sh", "-c", "export RESOLVER=$(grep nameserver /etc/resolv.conf | head -1 | awk '{print $2}') && envsubst '${RESOLVER}' < /etc/nginx/templates/default.conf.template > /etc/nginx/conf.d/default.conf && nginx -g 'daemon off;'"]
