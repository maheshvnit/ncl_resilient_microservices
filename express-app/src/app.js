const express = require('express');
const morgan = require('morgan');
const { logger } = require('./logger');
const routes = require('./routes');
const errorHandler = require('./errorHandler');

const app = express();
app.use(express.json());
app.use(morgan('combined', { stream: logger.stream }));
app.use('/api', routes);

app.get('/', (req, res) => {
	logger.info('GET /');
	res.send('Hello from Express');
});

// Global error handler (sends email + logs)
app.use(errorHandler);

module.exports = app;
