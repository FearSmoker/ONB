import { redis } from "../db/redis.js";

const WINDOW_MS = 60 * 60 * 1000; // 1-hour sliding window

function senderKeyPart(senderEmail: string) {
  return encodeURIComponent(senderEmail.toLowerCase());
}

// sliding window rate limiter using redis sorted sets
const SLIDING_WINDOW_LUA = `
  local key = KEYS[1]
  local now = tonumber(ARGV[1])
  local window = tonumber(ARGV[2])
  local limit = tonumber(ARGV[3])
  local uid = ARGV[4]

  local cutoff = now - window
  redis.call("ZREMRANGEBYSCORE", key, "-inf", cutoff)

  local count = redis.call("ZCARD", key)
  if count >= limit then
    local oldest = redis.call("ZRANGE", key, 0, 0, "WITHSCORES")
    local retryAt = 0
    if #oldest >= 2 then
      retryAt = tonumber(oldest[2]) + window
    else
      retryAt = now + window
    end
    return {0, count, retryAt}
  end

  redis.call("ZADD", key, now, uid)
  redis.call("PEXPIRE", key, window + 5000)
  return {1, limit - count - 1, 0}
`;

export async function reserveSendSlot(input: {
  userId: string;
  senderEmail: string;
  hourlyLimit: number;
}) {
  const limit = Math.max(1, input.hourlyLimit);
  const now = Date.now();
  const key = `ratelimit:sw:${input.userId}:${senderKeyPart(input.senderEmail)}`;
  // unique member so same-millisecond sends don't collide
  const uid = `${now}:${Math.random().toString(36).slice(2, 10)}`;

  const result = (await redis.eval(
    SLIDING_WINDOW_LUA,
    1,
    key,
    String(now),
    String(WINDOW_MS),
    String(limit),
    uid
  )) as [number, number, number];

  const allowed = Number(result[0]) === 1;
  const remaining = Number(result[1]);
  const retryAtMs = Number(result[2]);
  const windowStart = new Date(now - WINDOW_MS);

  return {
    allowed,
    retryAt: allowed ? new Date(now) : new Date(Math.max(retryAtMs, now + 1000)),
    remaining,
    hourStart: windowStart
  };
}

export async function shouldNotifyRateLimit(input: {
  userId: string;
  senderEmail: string;
  hourStart: Date;
}) {
  // deduplicate alert to once per hour bucket
  const hourBucket = Math.floor(input.hourStart.getTime() / (60 * 60 * 1000));
  const key = `notify:rate:${input.userId}:${senderKeyPart(input.senderEmail)}:${hourBucket}`;
  const result = await redis.set(key, "1", "EX", 2 * 60 * 60, "NX");
  return result === "OK";
}
