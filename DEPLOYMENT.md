# PW Office Production Deployment Guide

This document outlines the step-by-step instructions to deploy PW Office (consisting of the rebranded Express webapp, ONLYOFFICE Document Server, and PostgreSQL database) to a production cloud VM with HTTPS, reverse proxy, and automated database backups.

---

## 1. System Requirements & Provisioning
* **OS**: Ubuntu 22.04 LTS (Recommended)
* **Compute**: 2 vCPUs, 4GB RAM minimum (8GB RAM recommended for active concurrent editing).
* **Storage**: 40GB+ SSD (based on storage needs for uploaded document history).
* **DNS**: Point a domain/subdomain (e.g., `pwoffice.yourcompany.com`) to the server's public IP address.

---

## 2. Server Initial Configuration
Connect to the server via SSH and update packages:
```bash
sudo apt update && sudo apt upgrade -y
```

Install Docker and Docker Compose:
```bash
sudo apt install -y docker.io docker-compose
sudo systemctl enable --now docker
```

Configure the system firewall (UFW) to block direct external access to Postgres (5432) and the internal webapp port (3000):
```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow ssh       # Port 22
sudo ufw allow http      # Port 80
sudo ufw allow https     # Port 443
sudo ufw enable
```

---

## 3. Directory Layout & Setup
On the VM, create the application structure under `/opt/pwoffice`:
```bash
sudo mkdir -p /opt/pwoffice/storage
sudo mkdir -p /opt/pwoffice/backups
sudo mkdir -p /opt/pwoffice/nginx
```

Copy the application source code files, `nginx.conf`, and `docker-compose.yml` to the `/opt/pwoffice` directory on the server.

---

## 4. Production docker-compose.yml Configuration
Create `/opt/pwoffice/docker-compose.yml` with the following contents:

```yaml
version: '3.8'

services:
  postgres:
    image: postgres:15
    container_name: pwoffice-postgres
    restart: always
    environment:
      POSTGRES_DB: pwoffice
      POSTGRES_USER: pwadmin
      POSTGRES_PASSWORD: production_strong_password_here # CHANGE THIS
    volumes:
      - pgdata:/var/lib/postgresql/data
    expose:
      - "5432" # exposed to internal docker network only

  docserver:
    image: pwoffice-server:final
    container_name: pwoffice-docserver
    restart: always
    environment:
      JWT_ENABLED: "true"
      JWT_SECRET: fHgyNEq46tsbOsOJXeY7dLao9bz1Bjsa
      JWT_HEADER: Authorization
      JWT_IN_BODY: "true"
      ALLOW_PRIVATE_IP_ADDRESS: "true"
    volumes:
      - docserver_data:/var/www/onlyoffice/Data
      - docserver_log:/var/log/onlyoffice
    expose:
      - "80" # internal only

  webapp:
    build:
      context: ./pwoffice-webapp
      dockerfile: Dockerfile
    container_name: pwoffice-webapp
    restart: always
    depends_on:
      - postgres
      - docserver
    environment:
      - PORT=3000
      - JWT_SECRET=fHgyNEq46tsbOsOJXeY7dLao9bz1Bjsa # MUST match docserver secret
      - DOCUMENT_SERVER_PUBLIC_URL=https://pwoffice.yourcompany.com
      - WEBAPP_PUBLIC_URL=https://pwoffice.yourcompany.com
      - PGHOST=postgres
      - PGPORT=5432
      - PGUSER=pwadmin
      - PGPASSWORD=production_strong_password_here # MUST match postgres service
      - PGDATABASE=pwoffice
      - GROQ_API_KEY=gsk_your_production_key_here
    volumes:
      - /opt/pwoffice/storage:/app/storage
      - /opt/pwoffice/backups:/app/backups
    expose:
      - "3000"

  nginx:
    image: nginx:alpine
    container_name: pwoffice-nginx
    restart: always
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf:ro
      - /etc/letsencrypt:/etc/letsencrypt:ro
      - certbot-web:/var/www/certbot
    depends_on:
      - webapp
      - docserver

  certbot:
    image: certbot/certbot
    container_name: pwoffice-certbot
    volumes:
      - /etc/letsencrypt:/etc/letsencrypt
      - certbot-web:/var/www/certbot
    entrypoint: "/bin/sh -c 'trap exit 0; setInterval 12h; while :; do certbot renew; sleep 12h & wait $${!}; done;'"

volumes:
  pgdata:
  docserver_data:
  docserver_log:
  certbot-web:
```

---

## 5. SSL Certificate Acquisition (Let's Encrypt)
To obtain the SSL certificates, run Nginx in HTTP-only mode first to verify the domain via Certbot:

1. Edit `/opt/pwoffice/nginx.conf` temporarily to listen on port 80 only and comment out the 443 server block.
2. Spin up Nginx:
   ```bash
   sudo docker-compose up -d nginx
   ```
3. Request the certificate using Certbot:
   ```bash
   sudo docker-compose run --rm certbot certonly --webroot --webroot-path=/var/www/certbot --email webmaster@yourcompany.com --agree-tos --no-eff-email -d pwoffice.yourcompany.com
   ```
4. Revert `nginx.conf` back to the full HTTPS routing template and restart Nginx:
   ```bash
   sudo docker-compose restart nginx
   ```

---

## 6. Running and Monitoring the Application
Start all services in background daemon mode:
```bash
sudo docker-compose up -d
```

View running statuses and logs:
```bash
sudo docker-compose ps
sudo docker-compose logs -f webapp
sudo docker-compose logs -f docserver
```

---

## 7. Backups and Disaster Recovery
Backups are automatically taken by running the backup script on the webapp container:
```bash
sudo docker-compose exec webapp node backup.js
```
To automate this, add a cron job on the host system:
```bash
# Open crontab editor
sudo crontab -e

# Add entry to backup database daily at 2:00 AM
0 2 * * * docker exec pwoffice-webapp node /app/backup.js >> /var/log/pwoffice-backup.log 2>&1
```

To restore the database from a `.sql` backup file:
```bash
# Copy backup file into postgres container and run psql
docker cp /opt/pwoffice/backups/pwoffice_backup_TIMESTAMP.sql pwoffice-postgres:/tmp/backup.sql
docker exec -it pwoffice-postgres psql -U pwadmin -d pwoffice -f /tmp/backup.sql
```
