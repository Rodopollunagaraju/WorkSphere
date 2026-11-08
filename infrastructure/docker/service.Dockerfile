# One Dockerfile for every Node service. Build context = repo root.
#   docker build -f infrastructure/docker/service.Dockerfile --build-arg SERVICE=task-service .
FROM node:20-slim
ARG SERVICE
ENV SERVICE=${SERVICE} NODE_ENV=production
WORKDIR /app
COPY package.json ./
COPY shared ./shared
COPY services/${SERVICE} ./services/${SERVICE}
RUN npm install --omit=dev --workspace=@worksphere/${SERVICE} --include-workspace-root=false \
 && npm cache clean --force
USER node
# -r @worksphere/tracing enables OpenTelemetry when OTEL_EXPORTER_OTLP_ENDPOINT is set
CMD ["sh", "-c", "exec node -r @worksphere/tracing services/${SERVICE}/src/server.js"]
