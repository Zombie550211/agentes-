-- ═══════════════════════════════════════════════════════════════
--  CRM Connecting — Esquema MySQL
--  Motor: MySQL 8.0+
--  Campos JSON usan tipo JSON nativo de MySQL 5.7+
-- ═══════════════════════════════════════════════════════════════

CREATE DATABASE IF NOT EXISTS crm_connecting
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE crm_connecting;

-- ── USUARIOS ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
    id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    username      VARCHAR(100) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    name          VARCHAR(150),
    email         VARCHAR(200),
    role          VARCHAR(80)  NOT NULL DEFAULT 'agente',
    team          VARCHAR(100),
    supervisor    VARCHAR(100),
    avatar_url    VARCHAR(500),
    aliases       JSON,          -- array de strings
    permissions   JSON,          -- array de strings
    -- reset de contraseña
    reset_code_hash        VARCHAR(255),
    reset_code_expires_at  DATETIME,
    reset_code_attempts    TINYINT UNSIGNED DEFAULT 0,
    reset_token_hash       VARCHAR(255),
    reset_token_expires_at DATETIME,
    reset_token_used       BOOLEAN DEFAULT FALSE,
    created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_username  (username),
    INDEX idx_role      (role),
    INDEX idx_supervisor(supervisor),
    INDEX idx_team      (team)
) ENGINE=InnoDB;

-- ── LEADS / COSTUMERS UNIFIED ───────────────────────────────────
CREATE TABLE IF NOT EXISTS leads (
    id                  INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    mongo_id            VARCHAR(200),         -- _id original de Mongo (puede ser compuesto)
    nombre_cliente      VARCHAR(200),
    telefono_principal  VARCHAR(30),
    telefono            VARCHAR(30),
    telefono_alterno    VARCHAR(30),
    telefonos           JSON,                 -- array de teléfonos extra
    status              VARCHAR(50) DEFAULT 'pending',
    dia_venta           DATE,
    dia_instalacion     DATE,
    fecha_contratacion  DATE,
    servicios           JSON,                 -- array de strings
    tipo_servicio       VARCHAR(100),
    puntaje             DECIMAL(8,2) DEFAULT 0,
    agente              VARCHAR(150),
    agente_nombre       VARCHAR(150),
    usuario             VARCHAR(150),
    supervisor          VARCHAR(150),
    team                VARCHAR(100),
    equipo              VARCHAR(100),
    direccion           VARCHAR(300),
    zip_code            VARCHAR(100),
    numero_cuenta       VARCHAR(200),
    autopago            BOOLEAN,
    pin_seguridad       VARCHAR(30),
    mercado             VARCHAR(80),
    motivo_llamada      TEXT,
    nota                TEXT,
    producto            VARCHAR(150),
    was_reserva         BOOLEAN DEFAULT FALSE,
    excluir_de_reporte  BOOLEAN DEFAULT FALSE,
    source_collection   VARCHAR(100),         -- origen en Mongo
    created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
    created_by          VARCHAR(150),
    updated_at          DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    updated_by          VARCHAR(150),
    UNIQUE INDEX idx_mongo_id (mongo_id),
    INDEX idx_dia_venta      (dia_venta),
    INDEX idx_status         (status),
    INDEX idx_agente         (agente),
    INDEX idx_agente_nombre  (agente_nombre),
    INDEX idx_supervisor     (supervisor),
    INDEX idx_team           (team),
    INDEX idx_telefono       (telefono_principal),
    INDEX idx_created_at     (created_at)
) ENGINE=InnoDB;

-- ── COMENTARIOS DE LEADS ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS lead_comments (
    id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    lead_id    INT UNSIGNED NOT NULL,
    mongo_id   VARCHAR(24),
    texto      TEXT NOT NULL,
    autor      VARCHAR(150),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE,
    INDEX idx_lead_id (lead_id)
) ENGINE=InnoDB;

-- ── HISTORIAL DE ACTIVIDADES ────────────────────────────────────
CREATE TABLE IF NOT EXISTS activities (
    id               INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    mongo_id         VARCHAR(24),
    activity_type    VARCHAR(100),
    lead_client_name VARCHAR(200),
    description      TEXT,
    actor_username   VARCHAR(150),
    actor_role       VARCHAR(80),
    new_status       VARCHAR(50),
    old_status       VARCHAR(50),
    campos           JSON,         -- campos modificados
    timestamp        DATETIME,
    INDEX idx_actor     (actor_username),
    INDEX idx_timestamp (timestamp),
    INDEX idx_type      (activity_type)
) ENGINE=InnoDB;

-- ── MENSAJES DE CHAT ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS messages (
    id           INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    mongo_id     VARCHAR(24),
    from_user    VARCHAR(150),
    from_name    VARCHAR(200),
    from_avatar  VARCHAR(500),
    to_user      VARCHAR(150),
    to_name      VARCHAR(200),
    subject      VARCHAR(300),
    body         TEXT,
    type         VARCHAR(50) DEFAULT 'message',
    is_read      BOOLEAN DEFAULT FALSE,
    is_followup  BOOLEAN DEFAULT FALSE,
    read_at      DATETIME,
    timestamp    DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_from    (from_user),
    INDEX idx_to      (to_user),
    INDEX idx_ts      (timestamp),
    INDEX idx_is_read (is_read)
) ENGINE=InnoDB;

-- ── PRE-LEADS ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pre_leads (
    id                  INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    mongo_id            VARCHAR(24),
    lead_id             VARCHAR(100),
    nombre              VARCHAR(200),
    correo              VARCHAR(200),
    phone1              VARCHAR(30),
    phone2              VARCHAR(30),
    direccion           VARCHAR(300),
    fecha_nacimiento    DATE,
    servicio            VARCHAR(150),
    mercado             VARCHAR(80),
    nota                TEXT,
    agente_username     VARCHAR(150),
    agente_name         VARCHAR(200),
    status              VARCHAR(50) DEFAULT 'pending',
    nota_procesamiento  TEXT,
    fecha_venta         DATE,
    fecha_instalacion   DATE,
    resolucion          TEXT,
    resuelto_en         DATETIME,
    images              JSON,        -- array de {url, filename, uploadedAt}
    created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_agente (agente_username),
    INDEX idx_status (status)
) ENGINE=InnoDB;

-- ── CLIENTES TEAM LÍNEAS ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS lineas_clientes (
    id                INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    mongo_id          VARCHAR(200),
    collection_name   VARCHAR(100),   -- colección origen en TEAM_LINEAS
    nombre_cliente    VARCHAR(200),
    telefono_principal VARCHAR(30),
    telefono_alt      VARCHAR(30),
    telefonos         JSON,            -- array de números adicionales
    numero_cuenta     VARCHAR(100),
    autopago          BOOLEAN,
    pin_seguridad     VARCHAR(30),
    direccion         VARCHAR(300),
    zip_code          VARCHAR(20),
    mercado           VARCHAR(80),
    supervisor        VARCHAR(150),
    team              VARCHAR(100),
    servicio_interes  VARCHAR(150),
    notas             TEXT,
    status            VARCHAR(50) DEFAULT 'pending',
    dia_venta         DATE,
    dia_instalacion   DATE,
    cantidad_lineas   TINYINT UNSIGNED DEFAULT 1,
    servicios         JSON,            -- array de servicios
    lineas_status     JSON,            -- {0: "PENDING", 1: "ACTIVE", ...}
    lines_data        JSON,            -- array de {telefono, servicio, estado}
    agente            VARCHAR(150),
    agente_nombre     VARCHAR(150),
    agente_asignado   VARCHAR(150),
    puntaje           DECIMAL(8,2),
    fuente            VARCHAR(100),
    created_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at        DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_mongo_id    (mongo_id),
    INDEX idx_collection  (collection_name),
    INDEX idx_status      (status),
    INDEX idx_dia_venta   (dia_venta),
    INDEX idx_agente      (agente),
    INDEX idx_supervisor  (supervisor)
) ENGINE=InnoDB;

-- ── ARCHIVOS MULTIMEDIA ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS media_files (
    id           INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    mongo_id     VARCHAR(24),
    file_name    VARCHAR(300),
    file_type    VARCHAR(100),
    file_size    INT UNSIGNED,
    file_path    VARCHAR(500),
    category     VARCHAR(80),
    uploaded_by  VARCHAR(150),
    upload_date  DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_category (category),
    INDEX idx_uploader (uploaded_by)
) ENGINE=InnoDB;

-- ── EMPLEADO DEL MES ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS employees_month (
    id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    mongo_id    VARCHAR(24),
    employee    VARCHAR(150),
    name        VARCHAR(200),
    description TEXT,
    image_url   VARCHAR(500),
    period_date DATE,
    updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- ── PREMIOS ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS premios_activos (
    id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    mongo_id    VARCHAR(24),
    tipo        VARCHAR(50),
    titulo      VARCHAR(200),
    descripcion TEXT,
    categoria   VARCHAR(100),
    monto       DECIMAL(10,2),
    creado_por  VARCHAR(150),
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS premios_ganadores (
    id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    mongo_id    VARCHAR(24),
    tipo        VARCHAR(50),
    nombre      VARCHAR(200),
    iniciales   VARCHAR(10),
    monto       DECIMAL(10,2),
    categoria   VARCHAR(100),
    fecha       DATE,
    status      VARCHAR(50),
    creado_por  VARCHAR(150),
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- ── FACTURACIÓN RESIDENCIAL ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS facturacion (
    id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    mongo_id   VARCHAR(24),
    anio       SMALLINT UNSIGNED,
    mes        TINYINT UNSIGNED,
    dia        TINYINT UNSIGNED,
    fecha_str  VARCHAR(20),       -- DD/MM/YYYY original
    campos     JSON,              -- array de 17 strings
    created_by VARCHAR(150),
    updated_by VARCHAR(150),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_fecha (anio, mes, dia)
) ENGINE=InnoDB;

-- ── FACTURACIÓN LÍNEAS ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS facturacion_lineas (
    id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    mongo_id   VARCHAR(24),
    anio       SMALLINT UNSIGNED,
    mes        TINYINT UNSIGNED,
    dia        TINYINT UNSIGNED,
    fecha_str  VARCHAR(20),
    campos     JSON,              -- array de 9 strings
    created_by VARCHAR(150),
    updated_by VARCHAR(150),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_fecha (anio, mes, dia)
) ENGINE=InnoDB;

-- ── CONFIGURACIÓN DEL SISTEMA ───────────────────────────────────
CREATE TABLE IF NOT EXISTS system_settings (
    id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    `key`      VARCHAR(100) NOT NULL UNIQUE,
    value      JSON,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    updated_by VARCHAR(150),
    INDEX idx_key (`key`)
) ENGINE=InnoDB;

-- ── ROUND-ROBIN CONFIG ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS rr_config (
    id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    rr_key     VARCHAR(100) NOT NULL UNIQUE,
    idx        SMALLINT UNSIGNED DEFAULT 0,
    INDEX idx_rr_key (rr_key)
) ENGINE=InnoDB;

-- ── NOTAS DE LINEAS TEAM ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS lineas_notes (
    id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    lead_id    VARCHAR(200),
    texto      TEXT,
    type       VARCHAR(50) DEFAULT 'general',
    autor      VARCHAR(150),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_lead_id (lead_id)
) ENGINE=InnoDB;

-- ── LINEAS INTERNAS (db["Lineas"]) ──────────────────────────────
CREATE TABLE IF NOT EXISTS lineas_internal (
    id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    mongo_id   VARCHAR(24),
    agente     VARCHAR(150),
    agente_nombre VARCHAR(150),
    created_by VARCHAR(150),
    registered_by VARCHAR(150),
    status     VARCHAR(50),
    data       JSON,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_agente (agente)
) ENGINE=InnoDB;

-- ── LLAMADAS Y VENTAS DIARIAS ────────────────────────────────────
CREATE TABLE IF NOT EXISTS llamadas_ventas (
    id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    fecha      DATE NOT NULL,
    team       VARCHAR(100) NOT NULL,
    tipo       VARCHAR(50) NOT NULL,
    valor      DOUBLE DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    created_by VARCHAR(150),
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    updated_by VARCHAR(150),
    UNIQUE INDEX idx_fecha_team_tipo (fecha, team, tipo)
) ENGINE=InnoDB;

-- ── LLAMADAS VENTAS LINEAS ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS llamadas_ventas_lineas (
    id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    fecha      VARCHAR(20) NOT NULL UNIQUE,
    equipos    JSON,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    created_by VARCHAR(150),
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    updated_by VARCHAR(150),
    INDEX idx_fecha (fecha)
) ENGINE=InnoDB;

-- ── EXCEL SHEETS (llamadas_ventas_excel) ─────────────────────────
CREATE TABLE IF NOT EXISTS lv_excel_sheets (
    id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    name       VARCHAR(100) NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    created_by VARCHAR(150),
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    updated_by VARCHAR(150),
    INDEX idx_name (name)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS lv_excel_data (
    id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    sheet_id   INT UNSIGNED NOT NULL,
    kind       VARCHAR(20) DEFAULT 'cell',
    team       VARCHAR(100),
    person     VARCHAR(150),
    col        VARCHAR(50),
    metric     VARCHAR(100),
    value      VARCHAR(500),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    created_by VARCHAR(150),
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    updated_by VARCHAR(150),
    INDEX idx_sheet (sheet_id),
    INDEX idx_sheet_kind (sheet_id, kind)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS lv_excel_users (
    id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    sheet_id   INT UNSIGNED NOT NULL,
    name       VARCHAR(150) NOT NULL,
    role       VARCHAR(80),
    team       VARCHAR(100),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    created_by VARCHAR(150),
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    updated_by VARCHAR(150),
    INDEX idx_sheet (sheet_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS note_files (
    id           INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    mongo_id     VARCHAR(24),
    filename     VARCHAR(300) NOT NULL,
    original_name VARCHAR(300),
    content_type VARCHAR(150) DEFAULT 'application/octet-stream',
    file_type    VARCHAR(50),
    file_size    INT UNSIGNED DEFAULT 0,
    file_path    VARCHAR(500),
    lead_id      VARCHAR(100),
    uploaded_by  VARCHAR(150),
    uploaded_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_lead (lead_id),
    INDEX idx_uploader (uploaded_by)
) ENGINE=InnoDB;

-- ── INSERCIONES INICIALES ───────────────────────────────────────
INSERT IGNORE INTO system_settings (`key`, value) VALUES
  ('forceLogoutBefore', 'null'),
  ('maintenance', '{"active": false, "message": ""}');
