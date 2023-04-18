import Koa from "koa";
import Router from "koa-router";
import {
  Next,
  RelayerApp,
  StandardRelayerAppOpts,
  StandardRelayerContext,
  logging,
  wallets,
  missedVaas,
  providers,
  sourceTx,
} from "relayer-engine";
import { EVMChainId } from "@certusone/wormhole-sdk";
import { processGenericRelayerVaa } from "./processor";
import { Logger } from "winston";
import deepCopy from "clone";
import { loadAppConfig } from "./env";

export type GRContext = StandardRelayerContext & {
  relayProviders: Record<EVMChainId, string>;
  wormholeRelayers: Record<EVMChainId, string>;
  opts: StandardRelayerAppOpts;
};

async function main() {
  const { env, opts, relayProviders, wormholeRelayers } = await loadAppConfig();
  const logger = opts.logger!;
  logger.debug("Redis config: ", opts.redis);

  const app = new RelayerApp<GRContext>(env, opts);
  const {
    privateKeys,
    name,
    spyEndpoint,
    redis,
    redisCluster,
    redisClusterEndpoints,
    wormholeRpcs,
  } = opts;
  app.spy(spyEndpoint);
  app.useStorage({
    redis,
    redisClusterEndpoints,
    redisCluster,
    attempts: 3,
    namespace: name,
    queueName: `${name}-relays`,
  });
  app.logger(logger);
  app.use(logging(logger));
  app.use(
    missedVaas(app, {
      namespace: name,
      logger,
      redis,
      redisCluster,
      redisClusterEndpoints,
      wormholeRpcs,
    })
  );
  app.use(providers(opts.providers));
  if (opts.privateKeys && Object.keys(opts.privateKeys).length) {
    app.use(
      wallets(env, {
        logger,
        namespace: name,
        privateKeys: privateKeys!,
        metrics: { registry: app.metricsRegistry },
      })
    );
  }
  if (opts.fetchSourceTxhash) {
    app.use(sourceTx());
  }

  // Set up middleware
  app.use(async (ctx: GRContext, next: Next) => {
    ctx.relayProviders = deepCopy(relayProviders);
    ctx.wormholeRelayers = deepCopy(wormholeRelayers);
    ctx.opts = { ...opts };
    next();
  });

  // Set up routes
  app.multiple(deepCopy(wormholeRelayers), processGenericRelayerVaa);

  app.listen();
  runApi(app, opts, logger);
}

function runApi(relayer: any, { port, redis }: any, logger: Logger) {
  const app = new Koa();
  const router = new Router();

  router.get("/metrics", async (ctx: Koa.Context) => {
    ctx.body = await relayer.metricsRegistry?.metrics();
  });

  app.use(router.routes());
  app.use(router.allowedMethods());

  if (redis?.host) {
    app.use(relayer.storageKoaUI("/ui"));
  }

  port = Number(port) || 3000;
  app.listen(port, () => {
    logger.info(`Running on ${port}...`);
    logger.info(`For the UI, open http://localhost:${port}/ui`);
    logger.info(
      `For prometheus metrics, open http://localhost:${port}/metrics`
    );
    logger.info("Make sure Redis is running on port 6379 by default");
  });
}

main().catch((e) => {
  console.error("Encountered unrecoverable error:");
  console.error(e);
  process.exit(1);
});
