//jshint esversion:8

// ==============================================================================
// awcodeMySQL.js - Versión MySQL de nuestra To-Do List
// ==============================================================================
// En esta versión utilizamos MySQL como motor relacional en local.
// Mantenemos EXACTAMENTE las mismas vistas EJS (views/list.ejs) y la misma lógica de negocio,
// demostrando las diferencias sutiles entre PostgreSQL y MySQL.
// ==============================================================================

// Importación de módulos NPM necesarios
const express = require("express");          // Framework web para routing y manejo de peticiones HTTP
const bodyParser = require("body-parser");    // Middleware para parsear datos de formularios (req.body)
const mysql = require("mysql2/promise");     // Cliente de MySQL con soporte nativo de Promises (async/await)
const _ = require("lodash");                  // Utilidades de manipulación de texto (_.capitalize)

// Inicialización de la aplicación Express
const app = express();

// Configuración del motor de plantillas EJS y middlewares
app.set('view engine', 'ejs');
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static("public"));

// ==============================================================================
// 1. Configuración de conexión a MySQL
// ==============================================================================
// Parámetros de conexión local a MySQL (puedes sobreescribirlos con variables de entorno)
const DB_HOST = process.env.DB_HOST || "localhost";
const DB_USER = process.env.DB_USER || "root";
const DB_PASSWORD = process.env.DB_PASSWORD || "Pepito123";
const DB_NAME = process.env.DB_NAME || "todolistDB";
const DB_PORT = process.env.DB_PORT || 3306;

// Creación del Pool de conexiones a MySQL
// El pool gestiona conexiones reutilizables para optimizar el rendimiento.
const pool = mysql.createPool({
    host: DB_HOST,
    user: DB_USER,
    password: DB_PASSWORD,
    database: DB_NAME,
    port: DB_PORT,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// Elementos por defecto para sembrar la lista cuando se encuentra vacía
const defaultItems = [
    { name: "Welcome to your todolist!" },
    { name: "Hit the + button to add a new item." },
    { name: "<-- Hit this to delete an item." }
];

// ==============================================================================
// 2. Inicialización de la Base de Datos (DDL - Creación condicional de BD y tablas)
// ==============================================================================
// DIFERENCIAS CLAVE CON POSTGRESQL:
// - PostgreSQL usa SERIAL PRIMARY KEY; MySQL usa INT AUTO_INCREMENT PRIMARY KEY.
// - En MySQL podemos asegurar la creación previa de la base de datos con CREATE DATABASE IF NOT EXISTS.
async function initializeDB() {
    // 1. Conexión auxiliar sin base de datos seleccionada para asegurar que todolistDB existe
    const rootConnection = await mysql.createConnection({
        host: DB_HOST,
        user: DB_USER,
        password: DB_PASSWORD,
        port: DB_PORT
    });
    await rootConnection.query(`CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\`;`);
    await rootConnection.end();

    // 2. Creamos las tablas necesarias dentro de la base de datos
    // Tabla 'lists' (ej: 'Today', 'Trabajo', 'Estudio')
    await pool.query(`
        CREATE TABLE IF NOT EXISTS lists (
            id INT AUTO_INCREMENT PRIMARY KEY,
            name VARCHAR(255) UNIQUE NOT NULL
        );
    `);

    // Tabla 'items' (tareas individuales vinculadas a una lista con relación 1 a N)
    await pool.query(`
        CREATE TABLE IF NOT EXISTS items (
            id INT AUTO_INCREMENT PRIMARY KEY,
            name VARCHAR(255) NOT NULL,
            list_id INT NOT NULL,
            FOREIGN KEY (list_id) REFERENCES lists(id) ON DELETE CASCADE
        );
    `);

    console.log("✅ Base de datos y tablas de MySQL comprobadas/creadas correctamente (lists e items).");
}

// ==============================================================================
// 3. Rutas de la Aplicación (CRUD sobre MySQL)
// ==============================================================================
// DIFERENCIAS CLAVE CON POSTGRESQL:
// 1. En PostgreSQL los parámetros usan sintaxis de índice: $1, $2, etc.
//    En MySQL se utilizan signos de interrogación: ?
// 2. mysql2/promise devuelve una tupla [rows, fields]. Desestructuramos [rows] directamente.
// 3. Al hacer un INSERT, PostgreSQL usa RETURNING id, mientras que MySQL devuelve result.insertId.
// 4. Mantenemos el alias 'id AS _id' para que las vistas list.ejs sigan funcionando sin cambios.

// RUTA 1: GET / (Lista principal "Today")
app.get("/", async (req, res) => {
    try {
        // 1. Buscamos o creamos la lista principal "Today" en la tabla 'lists'
        const [lists] = await pool.query("SELECT * FROM lists WHERE name = ?", ["Today"]);
        let listId;
        
        //Obtener todas las listas creadas para el selector
        const [allLists] = await pool.query("SELECT name FROM lists ORDER BY name ASC");

        if (lists.length === 0) {
            // Si no existe, la creamos y obtenemos el nuevo ID generado (insertId)
            const [insertResult] = await pool.query("INSERT INTO lists (name) VALUES (?)", ["Today"]);
            listId = insertResult.insertId;
        } else {
            listId = lists[0].id;
        }

        // 2. Consultamos las tareas asociadas a esta lista (id AS _id para compatibilidad con EJS)
        const [items] = await pool.query(
            "SELECT id AS _id, name FROM items WHERE list_id = ? ORDER BY id ASC",
            [listId]
        );

        // 3. Si la lista no tiene tareas, sembramos las tareas por defecto
        if (items.length === 0) {
            for (const item of defaultItems) {
                await pool.query("INSERT INTO items (name, list_id) VALUES (?, ?)", [item.name, listId]);
            }
            res.redirect("/");
        } else {
            // Renderizamos la plantilla 'list.ejs' con los datos procedentes de MySQL
            res.render("list", { listTitle: "Today", newListItems: items, allLists: allLists});  //Variable añadida


        }
    } catch (err) {
        console.error("Error al obtener las tareas de Today:", err);
        res.status(500).send("Error al recuperar los elementos de MySQL");
    }
});

// RUTA 2: GET /:customListName (Listas personalizadas dinámicas)
app.get("/:customListName", async (req, res) => {
    const customListName = _.capitalize(req.params.customListName);
    
    // Obtener todas las listas creadas para el selector
    const [allLists] = await pool.query("SELECT name FROM lists ORDER BY name ASC");

    try {
        // Buscamos si la lista personalizada ya existe en la base de datos
        const [lists] = await pool.query("SELECT * FROM lists WHERE name = ?", [customListName]);

        if (lists.length === 0) {
            // Si no existe, creamos la lista y agregamos los elementos por defecto
            const [insertListResult] = await pool.query(
                "INSERT INTO lists (name) VALUES (?)",
                [customListName]
            );
            const listId = insertListResult.insertId;

            for (const item of defaultItems) {
                await pool.query("INSERT INTO items (name, list_id) VALUES (?, ?)", [item.name, listId]);
            }
            // Patrón Post-Redirect-Get hacia la nueva lista creada
            res.redirect("/" + customListName);
        } else {
            // Si la lista ya existe, recuperamos sus tareas
            const listId = lists[0].id;
            const [items] = await pool.query(
                "SELECT id AS _id, name FROM items WHERE list_id = ? ORDER BY id ASC",
                [listId]
            );
            const [allLists] = await pool.query("SELECT name FROM lists ORDER BY name ASC");

            res.render("list", { listTitle: customListName, newListItems: items, allLists: allLists}); //variable añadida 2
        }
    } catch (err) {
        console.error("Error al buscar la lista personalizada:", err);
        res.status(500).send("Error al encontrar la lista en MySQL");
    }
});

// RUTA 3: POST / (Crear una nueva tarea en la lista indicada)
app.post("/", async (req, res) => {
    const itemName = req.body.newItem; // Texto de la tarea introducido por el usuario
    const listName = req.body.list;    // Nombre de la lista ('Today' o lista personalizada)

    try {
        // 1. Obtenemos el ID de la lista donde queremos insertar
        const [lists] = await pool.query("SELECT id FROM lists WHERE name = ?", [listName]);
        let listId;

        if (lists.length === 0) {
            const [newListResult] = await pool.query("INSERT INTO lists (name) VALUES (?)", [listName]);
            listId = newListResult.insertId;
        } else {
            listId = lists[0].id;
        }

        // 2. Insertamos la nueva tarea con parámetros seguros (?) para prevenir SQL Injection
        await pool.query(
            "INSERT INTO items (name, list_id) VALUES (?, ?)",
            [itemName, listId]
        );

        // 3. Redirigimos a la ruta correspondiente (Patrón PRG)
        if (listName === "Today") {
            res.redirect("/");
        } else {
            res.redirect("/" + listName);
        }
    } catch (err) {
        console.error("Error al guardar la tarea:", err);
        res.status(500).send("Error al guardar el elemento en MySQL");
    }
});

// RUTA 4: POST /delete (Eliminar tarea por su ID)
app.post("/delete", async (req, res) => {
    const checkedItemId = req.body.checkbox; // ID numérico de la tarea a eliminar
    const listName = req.body.listName;       // Lista a la que pertenece la tarea

    try {
        // En MySQL borramos directamente por clave primaria (PRIMARY KEY)
        await pool.query("DELETE FROM items WHERE id = ?", [checkedItemId]);

        if (listName === "Today") {
            res.redirect("/");
        } else {
            res.redirect("/" + listName);
        }
    } catch (err) {
        console.error("Error al eliminar la tarea:", err);
        res.status(500).send("Error al eliminar el elemento en MySQL");
    }
});

// RUTA 5: GET /about (Página informativa estática)
app.get("/about", (req, res) => {
    res.render("about");
});

// ==============================================================================
// 4. Arranque del Servidor con Inicialización Previa de Base de Datos y Tablas
// ==============================================================================
const PORT = process.env.PORT || 3000;

async function startServer() {
    try {
        // Aseguramos la existencia de la base de datos y tablas antes de abrir el puerto
        await initializeDB();

        app.listen(PORT, function () {
            console.log(`🚀 Servidor iniciado con MySQL en el puerto ${PORT}`);
        });
    } catch (err) {
        console.error("❌ Error fatal al conectar o inicializar MySQL:", err);
        console.error("👉 Revisa que el servidor MySQL esté arrancado y que el usuario/contraseña sean correctos.");
        process.exit(1);
    }
}

// Arrancamos el servidor
startServer();

// ==============================================================================
// 🧠 SUPLEMENTO DIDÁCTICO: ¿CÓMO FUNCIONA LA CONCURRENCIA EN NODE.JS?
//    (Entendiendo 'async', 'await' y el 'Event Loop' sin dolor de cabeza)
// ==============================================================================
/*
  Para los estudiantes que se inician en Node.js, la concurrencia puede parecer
  misteriosa: ¿Cómo puede un servidor programado en un lenguaje de UN SOLO HILO
  (Single Thread) atender a miles de usuarios a la vez sin congelarse?

  La respuesta está en la combinación de tres piezas:
  1. La palabra clave 'async'
  2. La palabra clave 'await'
  3. El motor incansable: el 'Event Loop' (Bucle de Eventos)

  ------------------------------------------------------------------------------
  1. LA PALABRA 'async': AVISANDO A LA MÁQUINA VIRTUAL
  ------------------------------------------------------------------------------
  Cuando declaras una función normal:
      function sumar(a, b) { return a + b; }
  Node sabe que esa función se ejecuta de principio a fin del tirón, sin pausas,
  en unos pocos microsegundos.

  Pero cuando le pones 'async' delante:
      app.get("/", async (req, res) => { ... })
  Le estás diciendo a la Máquina Virtual V8 de Node:
  "¡Ojo! Esta función no es de un solo tirón. Es una función especial que
  contiene 'estaciones de parada'. Trátala de forma asíncrona y devuelve una
  Promesa, porque en varios momentos se pausará y me tocará volver a ella más tarde".

  ------------------------------------------------------------------------------
  2. LA PALABRA 'await': LA ESTACIÓN DE PARADA LOCAL
  ------------------------------------------------------------------------------
  Dentro de esa función, cada vez que ves un 'await':
      const [items] = await pool.query("SELECT * FROM items WHERE list_id = ?", [listId]);

  Ocurre algo fascinante:
  - Para ESA función en concreto, el tiempo se congela: la línea siguiente NO se
    ejecutará hasta que MySQL termine de leer el disco duro y nos devuelva los datos.
  - ¡PERO PARA EL RESTO DEL MUNDO, NODE NO SE CONGELA!
  Node no se queda "mirando al techo" con los brazos cruzados esperando a MySQL.
  Al ver el 'await', Node dice:
  "Dejo esta función 'pausada en una percha'. Mientras el cable de red y el motor de
  MySQL hacen su trabajo, libero el hilo principal para seguir haciendo otras cosas".

  ------------------------------------------------------------------------------
  3. LA METÁFORA DIDÁCTICA: EL BOTÓN DE CAMBIAR EL COLOR DE FONDO 🎨
  ------------------------------------------------------------------------------
  Imagina que nuestra aplicación tuviera un botón en pantalla que permitiera
  "Cambiar el color de fondo a morado, verde o azul".

  - MODELO TRADICIONAL ANTIGUO (Bloqueante / Síncrono):
    Si una consulta a la base de datos tardara 3 segundos en responder, la pantalla
    se quedaría completamente congelada. El cursor no respondería, el botón del
    color de fondo no haría clic y ningún otro usuario en el mundo podría entrar a la web.
    El camarero está en la cocina esperando a que hierva el agua sin atender a nadie más.

  - MODELO NODE.JS (Asíncrono con Event Loop):
    En cuanto llega al 'await pool.query(...)', el camarero deja el pedido en la
    cocina (MySQL) y regresa inmediatamente a la sala.
    ¿Quieres pulsar el botón de cambiar el color de fondo 50 veces mientras esperamos
    la respuesta de MySQL? ¡Puedes hacerlo! El servidor cambiará el color cuantas
    veces quieras por entretenerte, responderá a otros 200 usuarios que pidan la
    página /about, y procesará cualquier otro evento.

    En el momento exacto en que MySQL termina, la tarjeta de red avisa al sistema
    operativo y se deposita una notificación en la cola de tareas del Event Loop:
    "¡Los datos de la lista de tareas ya han llegado!".

    El Event Loop, que no para de dar vueltas comprobando tareas pendientes, recoge
    el aviso, desengancha la función que estaba congelada en el 'await', le entrega
    los datos en la variable [items], y la función continúa felizmente hacia adelante
    hasta hacer el res.render().

  ------------------------------------------------------------------------------
  4. ESQUEMA MENTAL DEL EVENT LOOP EN ACCIÓN
  ------------------------------------------------------------------------------

    Hilo Principal (Single Thread)                   En segundo plano (MySQL / Red)
   ================================                 ================================
   1. Entra petición GET /
   2. Ejecuta código hasta:
      await pool.query("SELECT...")  --------->    Envía consulta por socket TCP a MySQL.
   3. ⏸️ Pausa temporal de la ruta GET /            MySQL busca en las tablas de su disco...
      y LIBERA el Hilo Principal.                   (Tarda, por ejemplo, 40 ms)
   4. ¿Llegan clics del botón de color?
      🎨 Cambia color de fondo (10 veces).
   5. ¿Llega otro usuario a /about?
      📄 Le entrega la vista /about.
                                                   MySQL responde: "¡Aquí están las filas!"
   6. 🔔 El Event Loop recibe el aviso  <---------
   7. ▶️ Reanuda la función del GET /
      donde se quedó:
      const [items] = filasRecibidas;
   8. Ejecuta res.render("list", ...);
   9. Envía el HTML final al usuario.

  ------------------------------------------------------------------------------
  5. CONCLUSIÓN PARA EL ALUMNO
  ------------------------------------------------------------------------------
  - 'async' significa: "Esta función tiene permiso para pausarse en puntos intermedios".
  - 'await' significa: "Pausa SOLO esta función hasta que se resuelva la Promesa,
                        pero deja libre el procesador para todo lo demás".
  - El 'Event Loop' es el mayordomo hiperactivo que nunca duerme: mientras las bases
    de datos o los discos trabajan en segundo plano, él sigue atendiendo a todos los
    demás clientes a la velocidad del rayo.
*/


