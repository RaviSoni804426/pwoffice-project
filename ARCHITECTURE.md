# PW Office Architecture Documentation

This document describes the services, network ports, and data flow for the production deployment of **PW Office**.

---

## Services & Port Mapping

| Service | Technology | Port (Internal) | Port (Public) | Description |
| :--- | :--- | :--- | :--- | :--- |
| **PW Office Webapp** | Node.js (Express, EJS) | `3000` | `3000` (or `80`/`443` via reverse proxy) | User portal, authentication, workspace management, document dashboard, and AI chatbot proxy. |
| **Document Server** | ONLYOFFICE Document Server | `80` | `8080` (or `/` path routing via proxy) | Rendering and document editing engine. |
| **Database** | SQLite (currently local file) | — | — | Storage of user credentials, workspaces metadata, and document reference metadata. |
| **Groq AI Gateway** | Groq Cloud API | HTTPS (443) | — | External API used for document assistance and formula guidance chat completions. |

---

## Data Flow Diagram

```mermaid
sequenceDiagram
    autonumber
    actor User as User Browser
    participant WebApp as Node.js Webapp
    participant DocServer as Document Server
    participant DB as SQLite DB
    participant Groq as Groq AI API

    User->>WebApp: Log in / View workspaces
    WebApp->>DB: Query user & workspace metadata
    DB-->>WebApp: Return workspaces & document lists
    WebApp-->>User: Render dashboard UI

    User->>WebApp: Click on document "Open"
    WebApp->>WebApp: Generate secure JWT (HS256) signed with JWT_SECRET
    WebApp-->>User: Render editor EJS page with signed editorConfig

    User->>DocServer: Load editor interface (api.js)
    DocServer->>WebApp: Fetch file download: GET /api/download/:docId
    WebApp->>DB: Verify access & retrieve filepath
    DB-->>WebApp: Document metadata
    WebApp-->>DocServer: Stream file contents (Word/Excel binary)
    DocServer-->>User: Render workspace toolbar & document body

    Note over User, DocServer: User edits document in real-time
    DocServer->>WebApp: Callback updates: POST /api/callback/:docId
    WebApp->>DocServer: Download final saved file from callback URL
    WebApp->>DB: Update document last_modified timestamp
    
    User->>WebApp: Chatbot query: POST /api/chat
    WebApp->>Groq: Request completion (Llama 3.3 model)
    Groq-->>WebApp: Returns AI helper text
    WebApp-->>User: Displays response in floating chat widget
```

---

## Network & Security Architecture

1. **Authentication**: Cookie-based JWT authentication (`auth_token`) signed with a secure, random `JWT_SECRET`.
2. **Editor Protection**: All communications between the browser client and the ONLYOFFICE Document Server are protected using JWT signatures (`HS256`) signed with the same `JWT_SECRET`.
3. **Data Isolation**: Document assets are saved dynamically under `storage/<workspaceId>` folders on persistent storage volumes. Database queries enforce checking whether the logged-in user belongs to the requested workspace before exposing access routes.
