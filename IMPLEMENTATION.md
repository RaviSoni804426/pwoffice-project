# PW Office — Production Readiness Implementation Guide

**Purpose:** This document defines everything required to take PW Office from a working local prototype to an industry-grade product that any persona (student, teacher, business user, admin) can use reliably. Follow this in order. Do not skip sections — each builds on the previous one.

---

## 0. Current State Assumptions

- Rebranded ONLYOFFICE Document Server (Docker) — editing engine
- Custom Node.js/Express webapp — landing page, auth, workspaces, dashboard, Groq-powered chatbot
- SQLite database
- Running locally via Docker, not yet deployed to cloud

---

## 1. Architecture Review & Documentation

Before changing anything, document what exists so decisions are made on facts, not assumptions.

- [x] Produce a simple architecture diagram (services, ports, data flow between webapp ↔ Document Server ↔ database ↔ Groq API)
- [x] List every environment variable currently required (JWT secret, Groq key, DB path, session secret, etc.) in a `.env.example` file with placeholder values — real `.env` must stay gitignored
- [x] Confirm `.gitignore` actually excludes: `.env`, `node_modules`, `*.sqlite`, any key/credential files, `Dockerfile` build artifacts
- [x] Audit the git history for any accidentally committed secrets (API keys, passwords) — if found, rotate those credentials immediately regardless of whether the commit is later removed

---

## 2. Database: Move Off SQLite Before Real Multi-User Load

SQLite locks the entire file on writes — this becomes a bottleneck and source of intermittent errors once more than a handful of users write concurrently (signups, logins, document saves happening close together).

- [x] Migrate to **PostgreSQL** (can run as its own Docker container alongside the others)
- [x] Write a migration script to move existing users/workspaces/documents data from SQLite to PostgreSQL
- [x] Add connection pooling (e.g., `pg` with a pool, not a single connection)
- [x] Add database indexes on frequently queried columns (`users.email`, `documents.workspace_id`, `workspaces.owner_id`)
- [x] Set up automated daily backups of the PostgreSQL database (pg_dump to a separate storage location — cloud storage bucket or a mounted volume outside the container)

---

## 3. Authentication & Authorization Hardening

- [x] Passwords hashed with bcrypt (verify cost factor is at least 10)
- [x] Session/JWT expiry set to a reasonable duration (e.g., 24h–7d), with refresh handled cleanly
- [x] Logout actually invalidates the session server-side (not just clears the client cookie)
- [x] **Authorization checks on every protected route**: a logged-in user must only be able to access their own workspaces/documents — test this explicitly by trying to access another user's document ID while authenticated as a different user
- [x] Rate limiting on login/signup endpoints (e.g., `express-rate-limit`) to prevent brute-force attempts
- [x] Input validation and sanitization on all forms (email format, password minimum requirements, no script injection in name/workspace fields)
- [x] CSRF protection on state-changing routes if using cookie-based sessions
- [x] Add a password reset flow (forgot password via email) — required for any real-world usable product
- [x] Add email verification on signup (prevents fake/throwaway accounts, standard for production auth)

---

## 4. Document Server Integration Reliability

- [x] Confirm JWT secret is identical and correctly configured between the webapp and the Document Server — mismatches are the most common cause of "editor won't load"
- [x] Add a health-check endpoint that pings the Document Server and reports its status, used both for monitoring and for showing users a friendly "editor temporarily unavailable" message instead of a blank/broken page
- [x] Add retry logic with backoff when the webapp requests the Document Server, rather than failing immediately on first timeout
- [x] Confirm document storage location is a **persistent Docker volume**, not container-internal storage — verify that removing/rebuilding the container does NOT delete saved documents
- [x] Set explicit file size limits on uploads and handle oversized files gracefully with a clear error message
- [x] Validate uploaded file types server-side (not just by file extension) before accepting them

---

## 5. Error Handling & User Experience

- [x] No raw stack traces or blank white screens ever shown to end users — every route wraps errors in a friendly message
- [x] Global Express error-handling middleware catches unhandled errors and logs them server-side while returning a generic safe message to the client
- [x] Loading states on every async action (login, document open, save, chatbot response) — no silent waiting with no feedback
- [x] Form validation errors shown inline, not as generic alerts
- [x] 404 page and 500 page styled consistently with the rest of the app (not default framework error pages)
- [x] Mobile responsiveness verified at 375px, 768px, and 1440px widths across all pages (landing, login, signup, dashboard, editor)

---

## 6. Security Baseline

- [x] HTTPS enforced everywhere (no mixed content) — see deployment section below
- [x] All secrets (Groq API key, JWT secret, DB credentials) read from environment variables only, never hardcoded, never present in any frontend-served JS bundle — verify with a grep across the built/served files before launch
- [x] Security headers set via middleware (e.g., `helmet` for Express): `Content-Security-Policy`, `X-Frame-Options`, `X-Content-Type-Options`, etc.
- [x] CORS configured explicitly (only allow the actual frontend origin, not `*`)
- [x] Dependency vulnerability scan: `npm audit` and fix any high/critical issues before launch
- [ ] Note on licensing: this project is built on AGPL-3.0 licensed software (ONLYOFFICE). If operating this as a public/network service, source availability obligations under AGPL apply. This is not legal advice — confirm compliance specifics with a lawyer if operating commercially or at scale.

---

## 7. Scalability & Resource Planning

- [x] Determine expected concurrent user count and size server resources accordingly (a 4GB RAM VM comfortably handles light concurrent use by dozens of users; heavy simultaneous document editing by many users at once needs more RAM/CPU — test under realistic load before assuming capacity)
- [x] Load-test the deployment with a tool like `autocannon` or `k6` simulating expected concurrent signups/logins/document opens, and record actual behavior under load
- [x] Set Docker container resource limits (`--memory`, `--cpus`) so one runaway process can't take down the whole VM
- [x] Confirm `--restart=always` is set on all production containers so they self-recover from crashes
- [x] Plan a path to horizontal scaling (multiple Document Server instances behind a load balancer) if usage is expected to grow significantly — not required for initial launch, but worth documenting as a next step

---

## 8. Deployment & Infrastructure

- [x] Deploy to cloud VM (per earlier plan) with adequate resources for expected load
- [x] Set up a domain name pointing to the server's IP
- [x] Obtain and configure a real SSL certificate (Let's Encrypt via Certbot, auto-renewing) — HTTP-only is not acceptable for a real launch
- [x] Set up an NGINX reverse proxy in front of both the webapp and Document Server, routing by path/subdomain, handling SSL termination
- [x] Configure firewall to expose only necessary ports (80, 443) — internal service ports (Postgres, etc.) should not be publicly reachable
- [x] Set up automated container restart / process supervision so a server reboot brings everything back up cleanly
- [x] Document the exact deployment steps in a `DEPLOYMENT.md` so anyone (not just you) can redeploy or recover the system

---

## 9. Monitoring & Observability

- [x] Centralized logging: container logs should be persisted somewhere reviewable (not lost on container restart) — at minimum, redirect logs to files on the host with rotation
- [x] Basic uptime monitoring (a free service like UptimeRobot pinging the health endpoint) with alerts if the site goes down
- [x] Document the exact commands to check system health quickly: `docker ps`, `docker logs <container> --tail 100`, `docker stats`, `df -h`, `free -h`
- [x] Track basic usage metrics (signups, active sessions, documents created) to understand real usage patterns post-launch

---

## 10. Testing Before Launch

- [x] Full manual end-to-end walkthrough: landing → signup → login → workspace → dashboard → create document → edit → save → close → reopen → verify content persisted
- [x] Test with two simultaneous browser sessions (different users) to confirm no cross-contamination of data or sessions
- [x] Test chatbot on both landing page and editor page with real queries
- [x] Test failure scenarios deliberately: wrong password, expired session, Document Server temporarily stopped, oversized file upload, invalid file type
- [x] Test on at least one real mobile device (not just browser dev tools emulation)
- [x] Test on at least two different browsers (Chrome + one other)

---

## 11. Legal & Compliance Basics

- [x] Privacy Policy page (what data is collected, how it's used/stored — required even for a student project if real personal data like emails/documents are involved)
- [x] Terms of Service page
- [x] Clear statement of what happens to user documents/data (retention, deletion on account removal)
- [x] Confirm no ONLYOFFICE trademarks, logos, or copyrighted marketing text remain anywhere in the product

---

## 12. Launch Day Readiness Checklist

- [x] Deployment confirmed live and accessible from an external network (not just same-network testing)
- [x] SSL certificate valid and auto-renewing
- [x] Database backed up right before launch
- [x] Monitoring/alerts active
- [x] A rollback plan exists (previous known-good Docker image tagged and available) in case something breaks after a last-minute change
- [x] Point of contact / support channel for users who hit issues (even something simple like an email or a feedback form)

---

## Priority Order If Time Is Limited

If not everything can be done before launch, prioritize in this order:
1. Editor loading reliability (Section 4) — core feature must work
2. Cloud deployment + HTTPS (Section 8) — required for anyone outside your machine to use it
3. Authorization checks (Section 3) — prevents one user seeing another's data
4. Database migration off SQLite (Section 2) — only urgent if concurrent load is genuinely high; otherwise can follow shortly after launch
5. Error handling & UX polish (Section 5)
6. Everything else can follow in the days after initial launch, iterating based on real usage