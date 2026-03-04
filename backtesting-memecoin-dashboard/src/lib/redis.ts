import { createClient } from 'redis';

/**
 * Creates a Redis client with a strict connection timeout and error handling.
 * This prevents the dashboard from freezing when protocol backends are offline.
 */
export async function getRedisClientWithTimeout(url: string, timeoutMs: number = 1000) {
    const client = createClient({
        url,
        socket: {
            connectTimeout: timeoutMs,
            reconnectStrategy: false // Don't hang on retries if it sinks
        }
    });

    client.on('error', (err) => {
        // Suppress errors to console as we'll handle them in the connect try/catch
    });

    try {
        await client.connect();
        return client;
    } catch (e) {
        console.warn(`⚠️ Redis Offline (${url}): ${e}`);
        return null;
    }
}
