# Website v3 — seguimiento de hardening VPS (ago 2026)

Complementa [`vps-security-context.md`](vps-security-context.md). Ese documento era el brief para revisión. Este recoge **lo que se hizo después**, las **decisiones** (sí / no / más tarde) y correcciones de hecho.

Fecha de este lote: 18–19 ago 2026. Origen: Droplet `4geeks-website` (`68.183.106.196`). Código de deploy en el **fork** `alejandrojmnzz/website-v3` (no mergeado a `breatheco-de/website-v3` salvo que se pida).

No incluye valores de secretos.

---

## Corrección respecto al brief

El contexto original decía PostgreSQL (Drizzle). **La app usa SQLite** (`better-sqlite3`, `data/app.db`). El contenido de marketing está en YAML/git. Managed Postgres y backups de DB “enterprise” **no aplican** a esta escala.

---

## Decisiones (qué sí, qué no)

| Tema | Decisión | Motivo |
|------|----------|--------|
| sops / Vault / Doppler | **No** | Git ya no lleva secretos en claro; duplicar Actions no vale el ROI |
| `.env` desde `_WEBSITE_*` en Actions (`toJSON` + filtro) | **Sí** (ya en el workflow) | Rotar en GitHub, no editar el Droplet a mano |
| Blob de runtime por stdin (no cmdline SSH) | **Sí** | Evitar exponer el base64 en `ps` / `/proc/*/cmdline` del host remoto |
| Quitar `appleboy/ssh-action` | **Sí** | Un tercero no debe tener a la vez `DEPLOY_SSH_KEY` y el blob del `.env` |
| Pin de host key (`DEPLOY_SSH_KNOWN_HOSTS`) | **Sí** | El cliente SSH comprueba que la IP es *este* Droplet |
| Dependabot / `npm audit` bloqueando merge | **No por ahora** | Replit no lo tenía; ruido vs beneficio |
| Hardening systemd (versión corta) | **Sí** | Sandbox del proceso; no protege el `.env` |
| `RestrictAddressFamilies=AF_INET AF_INET6` | **No** | Puede romper DNS vía `systemd-resolved` |
| Backups Postgres / managed DB | **No** | No hay Postgres; SQLite es poco y reconstruible |
| Environment de Actions con required reviewers | **No en este lote** | Claude lo mencionó; no lo planeamos como bloqueante |
| Headers / rate limit `/mcp` como proyecto | **No ahora** | Checklist del cutover de `4geeks.com`, no de este lote |
| Túnel Cloudflare para cerrar el 22 | **Más tarde** | Mejora real; hace falta el CF de `4geeks.com`; pubkey + fail2ban cubren lo típico |
| CA SSH / Teleport / puerto SSH ≠ 22 | **No** | Complejidad o security-by-obscurity |
| AIDE sobre `/opt` | **No** | Cada deploy cambia ese árbol |
| Dos usuarios deploy vs runtime | **Sí** | RCE en Node ≠ usuario con SSH y sudo |
| Quitar permisos a `website-deployer` | **No** | Sigue siendo SSH, `git pull`, sudo acotado |
| Runtime sin write en `.git` de la app | **Sí** (lectura sí) | Evitar hooks/remote maliciosos; Node solo hace `git show` / `rev-parse` |
| `git config --system safe.directory /opt/website-v3` | **Sí, se deja** | Git 2.35+ bloquea “dubious ownership”; no quita privilegios a deployer |
| Consola web DO (root por `sshd`) | **Match localhost temporal** | La UI de DO usa SSH como root; `PermitRootLogin no` la rompe. El Match **sigue puesto** para poder ser root vía `ssh root@127.0.0.1`. **Pendiente quitarlo** (Recovery) cuando no se necesite. Prohibir password en el 22 público sigue siendo más seguro |

---

## Qué se implementó

### 1. Deploy: OpenSSH nativo + host key

**Problema:** `appleboy/ssh-action@v1.2.0` recibía la clave de deploy y `WEBSITE_RUNTIME_B64` en el mismo proceso. Un tag flotante se puede re-apuntar (supply chain). Sin `known_hosts`, el runner no fija la identidad de la máquina.

**Hecho:**

- Secret `DEPLOY_SSH_KNOWN_HOSTS` = salida de `ssh-keyscan -t ed25519` (misma cadena que `DEPLOY_HOST`: IP o hostname).
- `.github/workflows/deploy-vps.yml`: step `run:` con OpenSSH (`IdentitiesOnly`, `BatchMode`, `StrictHostKeyChecking=yes`). La clave se escribe en `$RUNNER_TEMP` (`printf … > archivo`), **no** a logs. No hay `set -x`.
- Primer run del YAML nuevo: GitHub mostró “workflow may be malicious” → **Approve and run**. Los pushes siguientes que **no** cambien el workflow no deberían pedir eso otra vez.
- Commit de referencia en el fork: `95f311e` (*Replace appleboy ssh-action with OpenSSH and a pinned host key*). Deploy verde.
- Nota operativa: si se reinstala/migra el Droplet y cambia la host key, el deploy fallará cerrado hasta regenerar `DEPLOY_SSH_KNOWN_HOSTS` con `ssh-keyscan -t ed25519 <host>` y actualizar el secret. Esto protege **Actions**; el acceso humano por laptop sigue con la política SSH local de cada operador (no se estandarizó host pinning manual).

**Qué no cambia:** quien tenga `DEPLOY_SSH_KEY` sigue pudiendo entrar al Droplet real. El pin evita entregar la sesión a un impostor en esa IP.

### 2. `.env` desde Actions (ya venía del lote anterior)

Pack en el runner: `toJSON(secrets)` + `toJSON(vars)`, keys `_WEBSITE_*`, strip del prefijo, blob base64. El blob se envía al host **por stdin** del `bash -s` remoto, no como parte del command string de `ssh`. En el Droplet se materializa `.env`. Si no hay keys `_WEBSITE_*`, se deja el archivo. `DEPLOY_*` no entra al `.env`.

El workflow remoto deja `.env` en **`640`**, dueño `website-deployer`, grupo `website-runtime` (runtime lee; no es `600` solo-deployer). Esto se corrige explícitamente en cada deploy para no depender de ajustes manuales en el Droplet.

### 3. Hardening de systemd

Drop-in `/etc/systemd/system/website.service.d/hardening.conf`:

```
[Service]
NoNewPrivileges=true
ProtectHome=true
PrivateTmp=true
ProtectSystem=strict
ReadWritePaths=/opt/website-v3
```

Limita un RCE **del proceso**: no ve `/home` (keys de deployer), `/etc` de solo lectura, no `sudo` desde el servicio. **No** oculta el `.env` (la app lo necesita). `website-deployer` por SSH no queda sandboxeado.

`website-deployer` no puede escribir `/etc` (sudoers acotado). Se aplicó como **root** (vía `ssh root@127.0.0.1` con el Match, no Recovery en el corte final).

### 4. Usuario `website-runtime`

**Antes:** `User=website-deployer` en `website.service.d/user.conf`. Node = el mismo user que SSH, `git pull` y sudo.

**Ahora:**

| User | Rol |
|------|-----|
| `website-deployer` (UID 1000) | SSH, deploy, sudo acotado. **Sin recorte de esos permisos.** |
| `website-runtime` (system, `nologin`, sin SSH) | `User=` / `Group=` del unit. Sin sudo. |

- `usermod -aG website-runtime website-deployer`
- `/opt/website-v3` en general: `website-deployer:website-runtime`, dirs `2775` (setgid), files `664`
- `.env`: `640`
- `/opt/website-v3/.git`: dueño `website-deployer`, grupo `website-runtime`, dirs `2750`, files `640` → runtime **lee**, no escribe. Deployer escribe en `git pull`.
- `git config --system --add safe.directory /opt/website-v3` para que `git rev-parse` / `git show` (logs y APIs de staff) no fallen por dubious ownership.

**Incidente:** `find … chmod 664` a todos los files quitó `+x` de `scripts/*.sh`, Qdrant y `node_modules/.bin`. El unit quedó en `activating`. Se restauró `775` en esos binarios/scripts. **No repetir** un `chmod 664` recursivo a todo `/opt`.

Health `http://127.0.0.1:5000/health` OK con `User=website-runtime`.

Node **sigue leyendo** `.env` (inevitable). Lo que pierde un RCE: identidad de deploy, `~/.ssh` (también `ProtectHome`), `systemctl`/`sudo`, y write en `.git` de la app. **Aún puede** escribir YAML/`site_*`, `data/`, cache, media y el resto de `/opt` salvo `.git`.

---

## Droplet Console vs Recovery vs root

- `PermitRootLogin no` **rompe** la Droplet Console web de DO (`?os_user=root`): esa UI autentica contra `sshd`, no es un TTY local. Error típico: *All configured authentication methods failed*.
- **Recovery ISO** sí da root sobre el disco montado (`/mnt`); al volver a Hard Drive el Ubuntu es el de siempre. En Settings: **Recovery mode → Edit** (no el recuadro Turn Off). `umount /mnt` es en la consola Recovery, no en el confirm del panel.
- Se añadió un `Match Address 127.0.0.1,::1` con `PermitRootLogin yes` + `PasswordAuthentication yes` para poder `ssh root@127.0.0.1` desde `website-deployer` (password de root). **El 22 público no debería aceptar password de root** si el resto del config sigue en `no`. Quien ya tiene shell de deployer **podría** probar esa password en localhost. Decisión: **quitar el Match más adelante**; por ahora se usó para aplicar systemd y runtime.

En `/etc/ssh/sshd_config` el `PermitRootLogin yes` del archivo distro puede seguir comentado/activo en el main; lo efectivo suele estar en `sshd_config.d`. Comprobar con `sshd -T` como root cuando se limpie el Match.

---

## Estado actual (resumen operativo)

```
Internet → (CF más adelante) → Nginx :80/443
                → 127.0.0.1:5000  website.service
                     User=website-runtime
                     ProtectSystem=strict, ReadWritePaths=/opt/website-v3
                     → 127.0.0.1:6333 Qdrant, :3001 MCP (si hay MCP_SERVER_SECRET)

SSH :22 → website-deployer (pubkey)
       → (temporal) root@127.0.0.1 si Match + password root

Actions → OpenSSH + known_hosts → git pull / write `.env` (`640`, grupo `website-runtime`) / sudo systemctl restart website
```

Fork: workflow `deploy-vps.yml` (pack `_WEBSITE_*` + SSH nativo). Bind loopback `127.0.0.1` en Node/MCP/Qdrant sigue siendo **solo fork**, no org/Replit.

---

## Pendiente (fuera de este lote)

1. Quitar el `Match` de localhost (sshd otra vez sin password/root ni en 127.0.0.1). Root de emergencia = Recovery.
2. Túnel `cloudflared` + cerrar 22 en el firewall DO (cuenta Cloudflare de `4geeks.com`).
3. Cutover DNS: Full (strict), headers, WAF / rate limit de API y `/mcp`.
4. Opcional más adelante: runtime sin write en `.git` ya está; se podría acotar más el árbol (no escribir `dist/` / fuentes) si se mapean todas las rutas de write del CMS.
5. Quitar el `Match` de localhost cuando ya no haga falta root por `ssh root@127.0.0.1`; objetivo final = root solo por Recovery.

---

## Relación con el brief (§6)

| Pregunta del brief | Respuesta de este lote |
|--------------------|-------------------------|
| Actions escribe `.env` vs Vault | Aceptable a esta escala; sops no |
| Puerto 22 | Se deja; túnel CF después |
| ¿Basta sudo acotado? | No del todo → **`website-runtime`** |
| Rate limit `/mcp` | No como proyecto ahora |
| Postgres fuera | N/A (SQLite) |
| Headers / jail Nginx | Cutover CF |
| ¿Es seguro que deployer escriba `.env`? | Mismo perímetro que el deploy; filtrar `_WEBSITE_*`; no appleboy |
