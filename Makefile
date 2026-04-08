SHELL := /bin/bash
.PHONY: install update claude-login claude-logout test logs delete

install:
	@echo "Setting up SSH keys..."
	@mkdir -p keys
	@if [ ! -f keys/beast-scanner ]; then \
		ssh-keygen -t ed25519 -f keys/beast-scanner -N "" -C "beast-scanner" -q; \
		chmod 600 keys/beast-scanner; \
		chmod 644 keys/beast-scanner.pub; \
		echo "  Generated ed25519 key pair in keys/"; \
	else \
		echo "  SSH keys already exist (keeping existing)"; \
	fi
	@if [ ! -f .env ]; then \
		cp .env.example .env; \
		echo "  Created .env from .env.example"; \
	fi
	@PUBKEY=$$(cat keys/beast-scanner.pub); \
	if grep -q "^SCANNER_SSH_PUBKEY=" .env 2>/dev/null; then \
		sed -i "s|^SCANNER_SSH_PUBKEY=.*|SCANNER_SSH_PUBKEY=$$PUBKEY|" .env; \
	else \
		echo "" >> .env; \
		echo "SCANNER_SSH_PUBKEY=$$PUBKEY" >> .env; \
	fi; \
	echo "  SSH public key written to .env"
	@if ! grep -q "^ENCRYPTION_KEY=" .env 2>/dev/null; then \
		EKEY=$$(openssl rand -hex 32); \
		echo "ENCRYPTION_KEY=$$EKEY" >> .env; \
		echo "  Encryption key generated"; \
	else \
		echo "  Encryption key already exists (keeping existing)"; \
	fi
	@if ! grep -q "^INTERNAL_TOKEN=" .env 2>/dev/null; then \
		ITOKEN=$$(openssl rand -hex 16); \
		echo "INTERNAL_TOKEN=$$ITOKEN" >> .env; \
		echo "  Internal API token generated"; \
	else \
		echo "  Internal API token already exists (keeping existing)"; \
	fi
	@echo ""
	@echo "Building and starting containers..."
	@docker compose up -d --build
	@echo ""
	@echo "=== BEAST Installation Complete ==="
	@echo "  1. Open http://localhost:8000"
	@echo "  2. Run 'make claude-login' to authenticate Claude Code scanner"

update:
	@echo "=== BEAST Update ==="
	@echo ""
	@echo "Pulling latest changes..."
	@git pull
	@echo ""
	@# Ensure any new env vars exist (won't overwrite existing)
	@if ! grep -q "^INTERNAL_TOKEN=" .env 2>/dev/null; then \
		ITOKEN=$$(openssl rand -hex 16); \
		echo "INTERNAL_TOKEN=$$ITOKEN" >> .env; \
		echo "  Added new env var: INTERNAL_TOKEN"; \
	fi
	@echo "Rebuilding containers..."
	@docker compose build
	@echo ""
	@echo "Restarting services..."
	@docker compose up -d
	@echo ""
	@echo "Waiting for API to be ready..."
	@for i in 1 2 3 4 5 6 7 8 9 10; do \
		if curl -sf http://localhost:3000/api/health > /dev/null 2>&1; then \
			echo "  API is ready"; \
			break; \
		fi; \
		sleep 2; \
	done
	@echo ""
	@echo "=== Update Complete ==="
	@echo "  Migrations run automatically on API startup."
	@echo "  Data, volumes, and Claude auth preserved."

claude-login:
	@echo "Checking Claude Code authentication..."
	@RESPONSE=$$(docker exec -u scanner -e HOME=/home/scanner $$(docker compose ps -q claude-runner) \
		sh -c 'echo "hi" | claude -p --max-turns 1 2>&1'); \
	if echo "$$RESPONSE" | grep -qi "not logged in\|authentication\|login"; then \
		echo "Not authenticated — starting login flow..."; \
		docker exec -it -u scanner -e HOME=/home/scanner $$(docker compose ps -q claude-runner) claude login; \
	elif [ -n "$$RESPONSE" ]; then \
		echo "Claude Code is already authenticated."; \
	else \
		echo "Not authenticated — starting login flow..."; \
		docker exec -it -u scanner -e HOME=/home/scanner $$(docker compose ps -q claude-runner) claude login; \
	fi

claude-logout:
	@echo "Logging out Claude Code from scanner..."
	@docker exec -u scanner -e HOME=/home/scanner $$(docker compose ps -q claude-runner) claude auth logout
	@echo "Done. Run 'make claude-login' to log in again."

test:
	./test.sh
	cd integration && npx vitest run

logs:
	docker compose logs -f --tail=50

delete:
	@echo "Stopping containers and removing all data..."
	@docker compose down -v --remove-orphans 2>&1 | grep -v 'variable is not set' || true
	@rm -f .env
	@rm -rf keys/
	@echo "Done. All containers, volumes, keys, and .env removed."
