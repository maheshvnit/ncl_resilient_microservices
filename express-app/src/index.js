const app = require('./app');
const { logger } = require('./logger');
const port = process.env.PORT || 3000;
app.listen(port, () => {
  logger.info(`Server running on port ${port}`);
});
