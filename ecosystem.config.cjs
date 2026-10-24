/* global module, __dirname */
const common = {
  cwd: `${__dirname}/apps/server`,
  interpreter: "node",
  node_args: "--env-file-if-exists=.env",
  instances: 1,
  exec_mode: "fork",
  autorestart: true,
  restart_delay: 3000,
  kill_timeout: 30000,
  time: true,
  env: {
    NODE_ENV: "production",
    HOST: "127.0.0.1",
    PORT: "6003",
    APP_ORIGIN: "http://127.0.0.1:6003",
  },
};

module.exports = {
  apps: [{ ...common, name: "socialsync", script: "dist/index.js" }],
};
