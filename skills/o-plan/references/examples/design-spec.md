# Worked Example: POST /auth/login

## contract
- Input: email (string, valid format), password (string, min 8 chars)
- Output on success: token (JWT string), user (id, email, created_at)
- Errors: 401 invalid credentials, 429 rate limit exceeded

## invariant
- Password is never stored in plaintext
- Failed login attempts are logged with IP and timestamp
- Token expiry is always ≤ 24 hours

## test
- Given valid credentials → return 200 with token
- Given invalid email format → return 400
- Given rate limit exceeded → return 429 after 5 failed attempts in 60s

## constraint
- Response time < 200ms at p95
- Supports up to 1000 concurrent login requests

## deferred
- OAuth provider integration (decided next iteration)

## Layers

### L0 — Mock Auth Endpoint
**Objective:** POST /auth/login answers any valid-format email and password with 200 and a JWT-like token
**Scope in:** the route, request validation, the response shape; password check and user lookup are stubs (always succeed, fixed user)
**Scope out:** real hashing, the user table, rate limiting
**Prerequisite:** none
**Risk:** low — the response shape is the only contract clients see, and it is pinned by the first test
**Definition of Done:**
- [ ] Lint check: `npm run lint`
- [ ] Endpoint responds to POST /auth/login with 200 and a JWT-like string
- [ ] System starts without errors: `node src/server.js`

### L1 — Real Authentication
**Objective:** valid credentials get a signed JWT and invalid ones a 401
**Scope in:** bcrypt comparison replaces "always succeeds"; a database query replaces the fixed user
**Scope out:** lockout, rate limiting, security headers
**Prerequisite:** Layer 0 complete and passing
**Risk:** medium — the user table's password column format is not confirmed; a mismatch shows as every login failing
**Definition of Done:**
- [ ] All L0 tests still pass (regression)
- [ ] Valid credentials return 200 with real JWT signed using project secret
- [ ] Invalid credentials return 401

### L2 — Security & Rate Limiting
**Objective:** repeated failures are slowed and every response carries the security headers
**Scope in:** a rate limiter on /auth/login, lockout after N failures, security headers
**Scope out:** OAuth providers (deferred)
**Prerequisite:** Layer 1 complete and passing
**Definition of Done:**
- [ ] 5 failed attempts in 60s → 429 response
- [ ] Security headers present in all responses
