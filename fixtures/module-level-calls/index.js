const app = require('./server')({ logger: true });
const other = require('./named-fn')();
const lib = require('./server');
const notAFunction = require('./missing')();
