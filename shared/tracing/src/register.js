// Preloaded with `node -r @worksphere/tracing/register`. No-op unless OTEL_EXPORTER_OTLP_ENDPOINT is set.
if (process.env.OTEL_EXPORTER_OTLP_ENDPOINT) {
  try {
    const { NodeSDK } = require('@opentelemetry/sdk-node');
    const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-http');
    const sdk = new NodeSDK({
      traceExporter: new OTLPTraceExporter(),
      instrumentations: [
        new (require('@opentelemetry/instrumentation-http').HttpInstrumentation)(),
        new (require('@opentelemetry/instrumentation-express').ExpressInstrumentation)(),
        new (require('@opentelemetry/instrumentation-mongodb').MongoDBInstrumentation)(),
        new (require('@opentelemetry/instrumentation-ioredis').IORedisInstrumentation)(),
        new (require('@opentelemetry/instrumentation-kafkajs').KafkaJsInstrumentation)(),
      ],
    });
    sdk.start();
    process.on('SIGTERM', () => sdk.shutdown().catch(() => {}));
  } catch (e) { console.error('tracing disabled:', e.message); }
}
