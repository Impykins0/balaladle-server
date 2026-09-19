import { env } from "cloudflare:workers";
import { httpServerHandler } from "cloudflare:node";
import express from "express";

const app = express();

// Error messages
const SERVER_ERROR_MSG = "Internal server error.";
const NOT_FOUND_ERROR_MSG = "404: not found.";

// Add endpoint middleware
app.use(express.json());

// Test to see if the server works
app.get("/test", (req, res) => {
	res.json({ 
        message: "The server works!" 
    });
});

// Retrieve friend-only leaderboard for the day
app.post("/leaderboard", ipRateLimit, async (req, res, next) => {
    if (!req.body) {
        raiseError(next, 400, "Missing required player ID.");
        return;
    }

    const { player_id } = req.body;

    if (!player_id) {
        raiseError(next, 400, "Missing required player ID.");
        return;
    } else if (typeof player_id !== "string" || !isValidSteamID(player_id)) {
        raiseError(next, 400, "Invalid player ID.");
        return;
    }

    const date = new Date().toISOString().slice(0, 10);

    try {
        const { success } = await env.LEADERBOARD_RATE_LIMITER.limit({ 
            key: player_id
        });
        if (!success) {
            res.set("Retry-After", "60");
            return res.status(429).json({
                error: "Too many requests. Please try again later."
            });
        }

        const friendIDs = await getFriendIDs(player_id, next);
        if (!friendIDs) { return; }

        const filteredIDs = [player_id, ...friendIDs];
        const placeholders = filteredIDs.map(() => "?").join(", ");

        const query = `
            WITH ranked_leaderboard AS (
                SELECT player_id, username, best_score,
                    RANK() OVER (
                        ORDER BY best_score ASC
                    ) AS rank
                FROM leaderboard
                WHERE submitted_date = ?
                    AND player_id IN (${placeholders})
            )
            SELECT player_id, username, best_score, rank
            FROM ranked_leaderboard
            WHERE rank <= 10 OR player_id = ?
            ORDER BY rank ASC, player_id ASC
        `;

        const { results } = await env.DB
            .prepare(query)
            .bind(date, ...filteredIDs, player_id)
            .all();

        const leaderboard = results
            .filter((entry) => entry.rank <= 10)
            .map((entry) => ({
                username: entry.username,
                best_score: entry.best_score
            }));

        const playerEntry = results.find(
            (entry) => entry.player_id === player_id
        );

        const player = playerEntry ? {
            rank: playerEntry.rank,
            score: playerEntry.best_score,
        } : null;

        return res.json({
            date,
            leaderboard,
            player,
        });
    } catch {
        raiseError(next, 500, SERVER_ERROR_MSG)
        return;
    }
});

// Submit valid attempt into the database
app.post("/attempts", ipRateLimit, async (req, res, next) => {
    if (!req.body) {
        raiseError(next, 400, "Missing required player ID.");
        return;
    }

    const { player_id, score } = req.body;

    if (!player_id) {
        raiseError(next, 400, "Missing required player ID.");
        return;
    } else if (typeof player_id !== "string" || !isValidSteamID(player_id)) {
        raiseError(next, 400, "Invalid player ID.");
        return;
    }

    if (score === undefined) {
        raiseError(next, 400, "Missing required score.");
        return;
    } else if (typeof score !== "number" || score < 0) {
        raiseError(next, 400, "Invalid score.");
        return;
    }

    const query = `
        INSERT INTO attempts (player_id, username, score)
        VALUES (?, ?, ?)
    `;

    try {
        const { success } = await env.ATTEMPTS_RATE_LIMITER.limit({ 
            key: player_id
        });
        if (!success) {
            res.set("Retry-After", "60");
            return res.status(429).json({
                error: "Too many requests. Please try again later."
            });
        }

        const username = await getSteamUsername(player_id, next);
        if (!username) { return; }

        await env.DB
            .prepare(query)
            .bind(player_id, username.trim(), score)
            .run()

        res.status(201).json({
            message: `Successfully submitted attempt for ${username}!`
        });
    } catch {
        raiseError(next, 500, SERVER_ERROR_MSG)
        return;
    }
});

// Request does not contain a valid endpoint
app.use((req, res, next) => {
    raiseError(next, 404, NOT_FOUND_ERROR_MSG);
    return;
});

app.listen(3000);
const expressHandler = httpServerHandler({ port: 3000 });

// Work-around for response truncations
export default {
    async fetch(request) {
        const response = await expressHandler.fetch(request);
        const body = await response.arrayBuffer();

        const headers = new Headers(response.headers);
        headers.delete("transfer-encoding");

        return new Response(body, {
            status: response.status,
            headers,
        });
    },
};

/**
 * Checks whether the given 64 bit Steam ID is valid.
 * @param {string} steamID - The given Steam ID
 * @returns {boolean}
 */
function isValidSteamID(steamID) {
    return typeof steamID === "string" && /^\d{17}$/.test(steamID);
}

/**
 * Returns the 64 bit Steam IDs of the friends of the user with the given 
 * Steam ID. If the user's friend list is private, throws an error.
 * @param {string} steamID - The given Steam ID
 * @param {express.NextFunction} next - The "next" middleware function
 * @returns {Promise<Array<string>>}
 */
async function getFriendIDs(steamID, next) {
    const url = new URL(
        "https://api.steampowered.com/ISteamUser/GetFriendList/v1/"
    );

    url.searchParams.set("key", env.STEAM_WEB_API_KEY);
    url.searchParams.set("steamid", steamID);
    url.searchParams.set("relationship", "friend");

    try {
        const res = await fetch(url);

        if (res.status === 401) {
            raiseError(next, 401, "User's friend list is currently private.")
            return;
        }
        else if (!res.ok) {
            raiseError(next, 500, "Unable to load friends right now.")
            return;
        }

        const data = await res.json();
        const friends = data.friendslist?.friends;

        return [steamID, ...friends.map((friend) => friend.steamid)];
    } catch {
        raiseError(next, 500, "A server error occurred.")
        return;
    }
}

/**
 * Returns the username of the user with the given Steam ID.
 * @param {string} steamID - The given Steam ID
 * @returns {Promise<string>}
 */
async function getSteamUsername(steamID, next) {
    const url = new URL(
        "https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/"
    );

    url.searchParams.set("key", env.STEAM_WEB_API_KEY);
    url.searchParams.set("steamids", steamID);

    try {
        const res = await fetch(url);

        if (!res.ok) {
            raiseError(next, 500, "Unable to load Steam user right now.");
            return;
        }

        const data = await res.json();
        const player = data.response?.players?.[0];

        if (!player || player.steamid !== steamID) {
            raiseError(next, 404, "Steam user could not be found.");
            return;
        }

        return player.personaname;
    } catch {
        raiseError(next, 500, "A server error occurred.")
        return;
    }
}

/**
 * Middleware that handles IP rate limiting.
 * @param {express.Request} req - The request object
 * @param {express.Response} res - The response object to send error message to
 * @param {express.NextFunction} next - The "next" middleware function
 * @returns {void} 
 */
async function ipRateLimit(req, res, next) {
    const ip = req.get("CF-Connecting-IP") ?? req.ip;

    try {
        const { success } = await env.IP_RATE_LIMITER.limit({
            key: ip,
        });
        if (!success) {
            res.set("Retry-After", "60");
            return res.status(429).json({
                error: "Too many requests. Please try again later."
            });
        }

        next();
    } catch (err) {
        raiseError(next, 500, "A server error occurred.")
        return;
    }
}

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
    if (err.status === 413) {
        return res.status(413).json({ 
            error: "Request is too large."
        });
    }

    res.status(err.status).json({
        error: err.status >= 500 ? "A server error occurred." : err.message
    });
}

// Adds error handling to the middleware stack
app.use(errorHandler);