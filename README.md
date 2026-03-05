<div align="center">
  <h1>🤖 Bot de WhatsApp con Panel Web 🌐</h1>
  <p>Un bot de WhatsApp de alto rendimiento con panel de control web admin, métricas en vivo, distintos modos de respuesta y soporte para MongoDB.</p>
  
  <p>
    <img src="https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=nodedotjs&logoColor=white" alt="Node.js" />
    <img src="https://img.shields.io/badge/Express.js-404D59?style=for-the-badge" alt="Express" />
    <img src="https://img.shields.io/badge/MongoDB-4EA94B?style=for-the-badge&logo=mongodb&logoColor=white" alt="MongoDB" />
    <img src="https://img.shields.io/badge/WhatsApp-25D366?style=for-the-badge&logo=whatsapp&logoColor=white" alt="WhatsApp" />
  </p>
</div>

<br/>

## 🌟 Características Principales

- **⚡ Ultra Rápido (Baileys):** Utiliza la librería `@whiskeysockets/baileys` para una conexión super rápida y directa mediante WebSockets.
- **🌐 Panel de Control Web:** Servidor web integrado (con Express.js) para controlar el bot remotamente, visualizar códigos QR de conexión, leer logs y métricas, y editar configuración de grupos.
- **🎛️ Diferentes Modos de Operación:**
  - **👀 Modo Watch:** Solo observa y registra mensajes de grupos (silencioso).
  - **⚡ Modo Flash:** Responde a todos los mensajes de forma ultra-rápida (fire-and-forget).
  - **🧠 Modo Normal:** Filtra por palabras clave específicas, responde de acuerdo a configuraciones de grupo y registra métricas detalladas.
- **🗄️ Persistencia con MongoDB:** Registro histórico, métricas de actividad (conteo de órdenes y grupos), y guardado persistente de la configuración de los grupos atendidos.
- **⏱️ Auto-Eliminación (Mensajes Efímeros):** Opción para que las respuestas enviadas por el bot desaparezcan tras una duración configurable.
- **🔐 Grupos Independientes:** Permite lock de grupos con límites de envíos predefinidos.

---

## 🚀 Instalación y Despliegue

### 1. Clonar el repositorio

```bash
git clone https://github.com/TuUsuario/bot_whatsap_yo.git
cd bot_whatsap_yo
```

### 2. Instalar dependencias

```bash
npm install
```

### 3. Configurar variables de entorno

Crea un archivo llamado `.env` en la raíz del proyecto (puedes basarte en `.env.example`) y configura tu conexión de Base de Datos y el puerto:

```env
# Ejemplo del .env
PORT=4310
MONGODB_URI=mongodb://localhost:27017/mi_bot_whatsapp
```

### 4. Ejecutar el proyecto

```bash
npm start
```

### 5. Escanear el código QR

1. Una vez ejecutado, abre la consola o dirígete al Panel de Control Web (`http://localhost:4310`).
2. Ve a tu aplicación de **WhatsApp** en tu teléfono -> **Dispositivos Vinculados** -> **Vincular Dispositivo**.
3. Escanea el código QR que se muestra para conectar el bot.

---

## 🛠️ Tecnologías Usadas

- **Node.js:** Entorno de ejecución en el servidor.
- **Express.js:** Framework para servir el panel administrativo web y gestionar rutas HTTP y APIs.
- **@whiskeysockets/baileys:** Librería esencial para manipular la conexión con la app web de WhatsApp.
- **MongoDB & Mongoose:** Base de datos para guardar todo el estado y registros.
- **qrcode-terminal & qrcode:** Renderización de códigos QR para el login (vía consola o web).
- **ws:** Manejo de WebSockets.

---

## 📂 Estructura del Proyecto

- `server.js`: Punto de entrada del servidor. Conecta DB, inicia web server y carga rutas.
- `src/bot/`: Cúmulo del core del chatbot.
  - `connection.js`: Gestión y ciclo de vida de la sesión de WhatsApp/Baileys.
  - `modes.js`: Lógica de comportamiento, respuesta e intercepción según los modos.
  - `filters.js`: Lógicas de filtrado de palabras clave.
- `src/routes/`: Rutas de la API (panel web - backend).
- `public/`: Interfaz Front-End (Dashboard, panel `.html`, `.css`, y `.js`).

---

## 🛡️ Licencia

Este proyecto está bajo la licencia **ISC**.
