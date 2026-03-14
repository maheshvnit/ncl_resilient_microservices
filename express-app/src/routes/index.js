const express = require('express');
const router = express.Router();
router.get('/ping', (req, res) => res.json({ pong: true }));

// Demo error route to test global error handling and email alerts
router.get('/error', (req, res, next) => {
	const err = new Error('Demo error from Express /api/error');
	err.demo = true;
	next(err);
});
module.exports = router;
