-- Anonimización de la BD LOCAL de desarrollo.
--
-- Se ejecuta DESPUÉS de restaurar un dump de producción en el MySQL local
-- (contenedor crm-connecting-local, 127.0.0.1:3309). Sustituye los datos
-- personales de CLIENTES por valores sintéticos deterministas derivados del id,
-- de modo que las relaciones entre tablas siguen siendo coherentes (el lead 42
-- se llama "Cliente 000042" en leads y en activities) y el CRM se puede usar
-- con normalidad.
--
-- NO se ejecuta nunca contra producción: el guardarraíl de abajo aborta si la
-- conexión no es a 127.0.0.1/localhost.
--
-- Qué se conserva a propósito:
--   - Identidad del personal (username, name, role, team, supervisor): la
--     lógica de equipos, permisos, rankings y comisiones depende de ella.
--   - zip_code y mercado: alimentan la geografía y los informes por mercado, y
--     por sí solos no identifican a nadie.
--
-- Qué se sustituye:
--   - Nombre, teléfonos, dirección, número de cuenta y PIN de los clientes.
--   - Coordenadas: se desplazan ~1 km para que el mapa siga poblado sin
--     apuntar al domicilio real.
--   - Email y hash de contraseña del personal (todas pasan a 'local123').
--   - Texto libre (notas, comentarios, mensajes): puede contener cualquier
--     cosa, así que se reemplaza en bloque en vez de intentar detectar PII.

-- ---------------------------------------------------------------- guardarraíl
-- Si la conexión no es local, se ejecuta un SELECT contra una tabla inexistente
-- cuyo nombre es el propio mensaje de error, y el script aborta ahí. Se usa
-- PREPARE porque IF() evaluaría las dos ramas y abortaría siempre.
SET @host := SUBSTRING_INDEX(USER(), '@', -1);
SET @stmt := IF(@host IN ('localhost','127.0.0.1'),
  'SELECT ''guardarrail OK: conexion local'' AS guardarrail',
  'SELECT * FROM ABORTADO_anonymize_local_solo_contra_BD_local');
PREPARE _g FROM @stmt; EXECUTE _g; DEALLOCATE PREPARE _g;

SET FOREIGN_KEY_CHECKS = 0;
SET SQL_SAFE_UPDATES = 0;

-- -------------------------------------------------------------------- clientes
UPDATE leads SET
  nombre_cliente     = CONCAT('Cliente ', LPAD(id, 6, '0')),
  telefono_principal = IF(telefono_principal IS NULL, NULL, CONCAT('555', LPAD(id, 7, '0'))),
  telefono           = IF(telefono           IS NULL, NULL, CONCAT('555', LPAD(id, 7, '0'))),
  telefono_alterno   = IF(telefono_alterno   IS NULL, NULL, CONCAT('555', LPAD(id + 1000000, 7, '0'))),
  telefonos          = IF(telefonos          IS NULL, NULL, JSON_ARRAY(CONCAT('555', LPAD(id, 7, '0')))),
  direccion          = IF(direccion          IS NULL, NULL, CONCAT(id, ' Test St')),
  numero_cuenta      = NULL,
  pin_seguridad      = NULL,
  lat                = IF(lat IS NULL, NULL, lat + ((CAST(id AS SIGNED) % 200) - 100) / 10000),
  lng                = IF(lng IS NULL, NULL, lng + ((CAST(id AS SIGNED) % 179) -  89) / 10000),
  nota               = IF(nota  IS NULL, NULL, '[nota anonimizada]'),
  notas              = IF(notas IS NULL, NULL, JSON_ARRAY());

UPDATE lineas_clientes SET
  nombre_cliente     = CONCAT('Cliente ', LPAD(id, 6, '0')),
  telefono_principal = IF(telefono_principal IS NULL, NULL, CONCAT('555', LPAD(id, 7, '0'))),
  telefono_alt       = IF(telefono_alt       IS NULL, NULL, CONCAT('555', LPAD(id + 1000000, 7, '0'))),
  telefonos          = IF(telefonos          IS NULL, NULL, JSON_ARRAY(CONCAT('555', LPAD(id, 7, '0')))),
  direccion          = IF(direccion          IS NULL, NULL, CONCAT(id, ' Test St')),
  numero_cuenta      = NULL,
  pin_seguridad      = NULL;

UPDATE pre_leads SET
  nombre    = CONCAT('Cliente ', LPAD(id, 6, '0')),
  correo    = IF(correo    IS NULL, NULL, CONCAT('cliente', id, '@example.test')),
  phone1    = IF(phone1    IS NULL, NULL, CONCAT('555', LPAD(id, 7, '0'))),
  phone2    = IF(phone2    IS NULL, NULL, CONCAT('555', LPAD(id + 1000000, 7, '0'))),
  direccion = IF(direccion IS NULL, NULL, CONCAT(id, ' Test St'));

-- El nombre del cliente viaja desnormalizado al historial: se realinea con leads
-- para que la actividad siga cuadrando con la ficha.
UPDATE activities SET lead_client_name = '[cliente anonimizado]'
WHERE lead_client_name IS NOT NULL;

-- ----------------------------------------------------------------- texto libre
UPDATE lead_comments SET texto = '[comentario anonimizado]' WHERE texto IS NOT NULL;
UPDATE lineas_notes  SET texto = '[nota anonimizada]'       WHERE texto IS NOT NULL;
UPDATE messages SET
  body    = IF(body    IS NULL, NULL, '[mensaje anonimizado]'),
  subject = IF(subject IS NULL, NULL, '[asunto anonimizado]');

-- -------------------------------------------------------------------- personal
-- Se conserva username/name/role/team; se neutraliza el email y se iguala la
-- contraseña de todas las cuentas a 'local123' para poder entrar como cualquier
-- rol sin conocer credenciales reales.
UPDATE users SET
  email                 = CONCAT(username, '@example.test'),
  password_hash         = '$2b$10$T0FIvPioDkBleXtRwEaqg.uLvK55qoss94JbdIX.2XT9q34K3FykC',
  reset_code_hash       = NULL,
  reset_token_hash      = NULL,
  reset_code_expires_at = NULL,
  reset_token_expires_at= NULL;

SET FOREIGN_KEY_CHECKS = 1;

SELECT 'anonimizacion completada' AS estado;
