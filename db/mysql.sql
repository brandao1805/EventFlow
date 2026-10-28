CREATE TABLE IF NOT EXISTS users (
 id CHAR(36) PRIMARY KEY, name VARCHAR(100) NOT NULL,
 email VARCHAR(180) NOT NULL UNIQUE, password_hash VARCHAR(256) NOT NULL,
 created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS sessions (
 token_hash CHAR(64) PRIMARY KEY, user_id CHAR(36) NOT NULL,
 expires_at DATETIME NOT NULL, FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
 INDEX idx_session_expiry(expires_at)
) ENGINE=InnoDB;
-- Registro transacional mínimo. Descrição, local e preço ficam no Cassandra.
CREATE TABLE IF NOT EXISTS event_registry (
 id CHAR(36) PRIMARY KEY, company_id CHAR(24) NOT NULL, owner_id CHAR(36) NOT NULL,
 month CHAR(7) NOT NULL, capacity INT NOT NULL, reserved INT NOT NULL DEFAULT 0,
 active BOOLEAN NOT NULL DEFAULT TRUE, synced BOOLEAN NOT NULL DEFAULT FALSE,
 FOREIGN KEY (owner_id) REFERENCES users(id),
 INDEX idx_owner(owner_id, active), INDEX idx_company(company_id, active),
 CHECK (capacity > 0), CHECK (reserved >= 0 AND reserved <= capacity)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS registrations (
 user_id CHAR(36) NOT NULL, event_id CHAR(36) NOT NULL, note VARCHAR(200) NOT NULL DEFAULT '',
 created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(user_id,event_id),
 FOREIGN KEY(user_id) REFERENCES users(id), FOREIGN KEY(event_id) REFERENCES event_registry(id)
) ENGINE=InnoDB;
-- Payload temporário: removido depois da confirmação da escrita no Cassandra.
CREATE TABLE IF NOT EXISTS outbox (
 id BIGINT AUTO_INCREMENT PRIMARY KEY, event_id CHAR(36) NOT NULL UNIQUE,
 payload JSON NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(event_id) REFERENCES event_registry(id)
) ENGINE=InnoDB;
