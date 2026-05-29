# Ibot v2

Bot de WhatsApp con Baileys, Node.js, MongoDB, panel web, múltiples cuentas, logs locales, vista de chats y modo IA con Z.AI.

## Cambios principales

- Proyecto preparado para pnpm/Corepack.
- Base nueva por defecto: `Ibotv2`.
- Modo `flash` eliminado.
- Modos disponibles: `normal`, `watch`, `ia`.
- Inicio, apagado y cierre de sesión separados.
- Apagar el bot ya no borra la sesión de WhatsApp.
- Reconexión protegida contra sockets/listeners duplicados.
- Grupos cacheados en memoria para respuesta rápida.
- Contadores persistidos con cola en segundo plano.
- Logs de consola en archivo local por cuenta, no en MongoDB.
- Chats de grupos en archivo local por cuenta.
- Ventana `Grupos` separada de `Configuración`.
- Nueva ventana de configuración para modo normal e IA.
- Vista Logs con modos `Consola` y `Chats`.

## Instalación

```bash
corepack enable
corepack prepare pnpm@11.0.0 --activate
pnpm install
cp .env.example .env
nano .env
pnpm start
```

## Variables importantes

```env
MONGODB_URI=mongodb://127.0.0.1:27017
MONGODB_DB=Ibotv2
DEFAULT_ACCOUNT_ID=tago
PANEL_AUTH_ENABLED=true
PANEL_USER=admin
PANEL_PASSWORD=cambia_esta_clave
ZAI_API_KEY=
```

## Migración opcional desde v1

La base vieja no se toca. Para copiar grupos y contador desde `Ibot` hacia `Ibotv2`:

```bash
MONGODB_DB_OLD=Ibot MONGODB_DB=Ibotv2 pnpm migrate:v1
```

## Uso del modo IA

Entra a `/configuracion.html`, selecciona modo `IA`, activa IA, configura API key/modelo/comandos y guarda. El endpoint por defecto es compatible con `/chat/completions` de Z.AI.

## Seguridad

En producción deja `PANEL_AUTH_ENABLED=true` y cambia `PANEL_PASSWORD`. No expongas el panel sin autenticación.
