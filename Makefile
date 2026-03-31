SHELL := /bin/bash
.PHONY: install auth test logs delete

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
	@echo ""
	@echo "Building and starting containers..."
	@docker compose up -d --build
	@echo ""
	@echo "=== BEAST Installation Complete ==="
	@echo "  1. Open http://localhost:8000"
	@echo "  2. Run 'make auth' to authenticate Claude Code scanner"

auth:
	@docker exec -it -u scanner -e HOME=/home/scanner $$(docker compose ps -q claude-runner) claude login

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
