// Set writable paths before the Wrangler module is imported by the D1 integration suite.
process.env.WRANGLER_LOG_PATH = '/tmp/weather-test-wrangler/logs';
process.env.XDG_CONFIG_HOME = '/tmp/weather-test-wrangler/config';
