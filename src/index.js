import { env } from "cloudflare:workers";
import { httpServerHandler } from "cloudflare:node";
import express from "express";

const app = express();

// Error messages
const SERVER_ERROR_MSG = 'Internal server error.';
const NOT_FOUND_ERROR_MSG = '404: not found.';

// Add endpoint middleware
app.use(express.json());

// Test to see if the server works
app.get("/test", (req, res) => {
	res.json({ 
        message: "The server works!" 
    });
});

// Request does not contain a valid endpoint
app.use((req, res, next) => {
    raiseError(next, 404, NOT_FOUND_ERROR_MSG);
});

app.listen(3000);
export default httpServerHandler({ port: 3000 });

/**
 * Forwards an HTTP error to the error-handling middleware.
 * @param {express.NextFunction} next - The "next" middleware function
 * @param {number} status - The HTTP status code to return
 * @param {string} message - The error message to send
 * @returns {void}
 */
function raiseError(next, status, message) {
    const err = new Error(message);
    err.status = status;
    next(err);
}

/**
 * Middleware that handles different types of errors. Functions that call "next"
 * with an error object are handled by this middleware appropriately.
 * @param {Error} err - Error that was encountered
 * @param {express.Request} req - The request object
 * @param {express.Response} res - The response object to send error message to
 * @param {express.NextFunction} next - The "next" middleware function
 * @returns {void} 
 */
function errorHandler(err, req, res, next) {
    res.status(err.status).json({
        error: err.message,
    });
}

// Adds error handling to the middleware stack
app.use(errorHandler);