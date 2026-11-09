//jshint esversion:8

// ==============================================================================
// awcodeMySQLJoin.js - Ejercicio Didáctico: INNER JOIN y LEFT JOIN en MySQL
// ==============================================================================
// En este ejercicio didáctico usamos tablas aisladas con sufijo _join:
// 1. lists_join       -> Las listas existentes (ej. 'Today', 'Trabajo')
// 2. priorities_join  -> Catálogo de urgencias (Alta, Media, Baja) con colores e iconos
// 3. items_join       -> Tareas vinculadas obligatoriamente a una lista (INNER JOIN)
//                        y opcionalmente a una urgencia (LEFT JOIN)
// Esto evita cualquier colisión con la versión estándar de awcodeMySQL.js.
// ==============================================================================

const express = require("express");
const bodyParser = require("body-parser");
const mysql = require("mysql2/promise");
const _ = require("lodash");

const app = express();

app.set('view engine', 'ejs');
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static("public"));

// Configuración de conexión local a MySQL
const DB_HOST = process.env.DB_HOST || "localhost";
const DB_USER = process.env.DB_USER || "root";
const DB_PASSWORD = process.env.DB_PASSWORD || "Pepito123";
const DB_NAME = process.env.DB_NAME || "todolistDB";
const DB_PORT = process.env.DB_PORT || 3306;

const pool = mysql.createPool({
    host: DB_HOST,
    user: DB_USER,
    password: DB_PASSWORD,
    database: DB_NAME,
    port: DB_PORT,
    waitForConnections: true,
    connectionLimit: 10
});

// Tareas por defecto para sembrar la lista si está vacía
const defaultItems = [
    { name: "Welcome to your todolist!", priority_id: 2 },        // Urgencia Media
    { name: "Hit the + button to add a new item.", priority_id: null }, // SIN urgencia (demuestra LEFT JOIN)
    { name: "<-- Hit this to delete an item.", priority_id: 1 }    // Urgencia Alta
];

// ==============================================================================
// 1. Inicialización del Esquema Relacional Aislado (lists_join, priorities_join, items_join)
// ==============================================================================
async function initializeDB() {
    // Conexión auxiliar para asegurar que la base de datos existe
    const rootConnection = await mysql.createConnection({
        host: DB_HOST,
        user: DB_USER,
        password: DB_PASSWORD,
        port: DB_PORT
    });
    await rootConnection.query(`CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\`;`);
    await rootConnection.end();

    // 1. Tabla de Listas Aislada
    await pool.query(`
        CREATE TABLE IF NOT EXISTS lists_join (
            id INT AUTO_INCREMENT PRIMARY KEY,
            name VARCHAR(255) UNIQUE NOT NULL
        );
    `);

    // 2. Tabla de Prioridades / Urgencias Aislada
    await pool.query(`
        CREATE TABLE IF NOT EXISTS priorities_join (
            id INT AUTO_INCREMENT PRIMARY KEY,
            name VARCHAR(50) UNIQUE NOT NULL,
            badge_color VARCHAR(20) NOT NULL,
            icon VARCHAR(10) NOT NULL
        );
    `);

    // 3. Tabla de Items con 2 Claves Foráneas:
    //    - list_id (OBLIGATORIA -> justifica INNER JOIN con lists_join)
    //    - priority_id (OPCIONAL/NULL -> justifica LEFT JOIN con priorities_join)
    await pool.query(`
        CREATE TABLE IF NOT EXISTS items_join (
            id INT AUTO_INCREMENT PRIMARY KEY,
            name VARCHAR(255) NOT NULL,
            list_id INT NOT NULL,
            priority_id INT NULL,
            FOREIGN KEY (list_id) REFERENCES lists_join(id) ON DELETE CASCADE,
            FOREIGN KEY (priority_id) REFERENCES priorities_join(id) ON DELETE SET NULL
        );
    `);

    // Si la tabla de prioridades está vacía, sembramos las 3 urgencias base
    const [priorities] = await pool.query("SELECT COUNT(*) AS total FROM priorities_join");
    if (priorities[0].total === 0) {
        await pool.query(`
            INSERT INTO priorities_join (name, badge_color, icon) VALUES 
            ('Alta', '#e74c3c', '🔴'),
            ('Media', '#f39c12', '🟡'),
            ('Baja', '#2ecc71', '🟢');
        `);
        console.log("🌱 Catálogo de prioridades sembrado en priorities_join (Alta, Media, Baja).");
    }

    console.log("✅ Esquema relacional comprobado (lists_join, priorities_join, items_join).");
}

// Función auxiliar para obtener todas las prioridades disponibles
async function getAllPriorities() {
    const [rows] = await pool.query("SELECT * FROM priorities_join ORDER BY id ASC");
    return rows;
}

// ==============================================================================
// 2. Consulta Maestra con INNER JOIN y LEFT JOIN
// ==============================================================================
// 🔍 EXPLICACIÓN DIDÁCTICA:
// - INNER JOIN lists_join: Cada tarea pertenece estrictamente a una lista. Si no coincide, se descarta.
// - LEFT JOIN priorities_join: La urgencia es OPCIONAL (priority_id puede ser NULL).
//   * Si usáramos INNER JOIN, ¡las tareas sin urgencia desaparecerían de la vista!
//   * Con LEFT JOIN, se conservan TODAS las tareas de items_join. Si no tienen urgencia,
//     los campos priority_name y priority_color valen NULL.
async function getItemsWithJoins(listName) {
    const query = `
        SELECT 
            items_join.id AS _id,
            items_join.name AS name,
            items_join.list_id,
            items_join.priority_id,
            lists_join.name AS list_name,
            priorities_join.name AS priority_name,
            priorities_join.badge_color AS priority_color,
            priorities_join.icon AS priority_icon
        FROM items_join
        INNER JOIN lists_join ON items_join.list_id = lists_join.id
        LEFT JOIN priorities_join ON items_join.priority_id = priorities_join.id
        WHERE lists_join.name = ?
        ORDER BY items_join.id ASC;
    `;
    const [rows] = await pool.query(query, [listName]);
    return rows;
}

// ==============================================================================
// 3. Rutas de la Aplicación
// ==============================================================================
// ⚠️ IMPORTANTE (REGLA DE ENRUTAMIENTO EN EXPRESS):
// Las rutas estáticas fijas como '/comparativa-joins' o '/about' SIEMPRE deben definirse
// ANTES de las rutas con comodín dinámico como '/:customListName'.
// Si pusieras '/:customListName' primero, capturaría 'comparativa-joins' como si fuera
// el nombre de una lista y la petición se quedaría congelada.

// RUTA 1: GET / (Lista principal "Today")
app.get("/", async (req, res) => {
    try {
        const [lists] = await pool.query("SELECT * FROM lists_join WHERE name = ?", ["Today"]);
        let listId;
        //obtengo listas
        const [allLists] = await pool.query("SELECT name FROM lists_join ORDER BY name ASC");


        if (lists.length === 0) {
            const [insertResult] = await pool.query("INSERT INTO lists_join (name) VALUES (?)", ["Today"]);
            listId = insertResult.insertId;

            // Sembramos tareas por defecto
            for (const item of defaultItems) {
                await pool.query(
                    "INSERT INTO items_join (name, list_id, priority_id) VALUES (?, ?, ?)",
                    [item.name, listId, item.priority_id]
                );
            }
        }

        // Ejecutamos la consulta con INNER JOIN y LEFT JOIN
        const items = await getItemsWithJoins("Today");
        const priorities = await getAllPriorities();

        res.render("list", { 
            listTitle: "Today", 
            newListItems: items,
            priorities: priorities,
            allLists: allLists   //variable add
        });
    } catch (err) {
        console.error("Error en GET /:", err);
        res.status(500).send("Error al recuperar los elementos con JOIN: " + err.message);
    }
});

// RUTA 2 (DIDÁCTICA): GET /comparativa-joins (Laboratorio en Vivo)
// Visita http://localhost:3000/comparativa-joins para ver la diferencia en tiempo real
app.get("/comparativa-joins", async (req, res) => {
    try {
        // Aseguramos que la lista 'Today' exista para poder mostrar la comparativa
        const [lists] = await pool.query("SELECT * FROM lists_join WHERE name = ?", ["Today"]);
        if (lists.length === 0) {
            const [insertResult] = await pool.query("INSERT INTO lists_join (name) VALUES (?)", ["Today"]);
            const listId = insertResult.insertId;
            for (const item of defaultItems) {
                await pool.query(
                    "INSERT INTO items_join (name, list_id, priority_id) VALUES (?, ?, ?)",
                    [item.name, listId, item.priority_id]
                );
            }
        }

        // Consulta 1: Con INNER JOIN en priorities_join (descarta las tareas sin urgencia)
        const [innerJoinResults] = await pool.query(`
            SELECT items_join.id, items_join.name, priorities_join.name AS prioridad
            FROM items_join
            INNER JOIN lists_join ON items_join.list_id = lists_join.id
            INNER JOIN priorities_join ON items_join.priority_id = priorities_join.id
            WHERE lists_join.name = 'Today';
        `);

        // Consulta 2: Con LEFT JOIN en priorities_join (conserva todas las tareas)
        const [leftJoinResults] = await pool.query(`
            SELECT items_join.id, items_join.name, COALESCE(priorities_join.name, 'Sin urgencia (NULL)') AS prioridad
            FROM items_join
            INNER JOIN lists_join ON items_join.list_id = lists_join.id
            LEFT JOIN priorities_join ON items_join.priority_id = priorities_join.id
            WHERE lists_join.name = 'Today';
        `);

        res.send(`
            <!DOCTYPE html>
            <html lang="es">
            <head>
                <meta charset="UTF-8">
                <title>Laboratorio Didáctico de JOINs</title>
                <style>
                    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f4f7f6; padding: 30px; color: #333; }
                    h1 { color: #5a32a3; }
                    .container { display: flex; gap: 30px; margin-top: 20px; }
                    .card { flex: 1; background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.08); }
                    .card h2 { margin-top: 0; font-size: 18px; }
                    .badge-inner { color: #d9534f; font-weight: bold; }
                    .badge-left { color: #2e6da4; font-weight: bold; }
                    table { width: 100%; border-collapse: collapse; margin-top: 15px; }
                    th, td { border: 1px solid #e1e4e8; padding: 10px; text-align: left; }
                    th { background: #fafbfc; }
                    .null-val { color: #888; font-style: italic; }
                    .back-btn { display: inline-block; margin-top: 25px; padding: 10px 18px; background: #A683E3; color: white; text-decoration: none; border-radius: 5px; font-weight: 500; }
                </style>
            </head>
            <body>
                <h1>🧪 Laboratorio Didáctico: INNER JOIN vs LEFT JOIN</h1>
                <p>Observa cómo se comporta cada consulta sobre las mismas tareas en la lista <strong>Today</strong>:</p>

                <div class="container">
                    <div class="card">
                        <h2 class="badge-inner">❌ Con INNER JOIN priorities_join</h2>
                        <p><strong>Total filas devueltas: ${innerJoinResults.length}</strong> (Excluye todas las tareas que no tienen urgencia asignada).</p>
                        <table>
                            <tr><th>ID</th><th>Tarea</th><th>Prioridad</th></tr>
                            ${innerJoinResults.map(i => `<tr><td>${i.id}</td><td>${i.name}</td><td>${i.prioridad}</td></tr>`).join("")}
                        </table>
                    </div>

                    <div class="card">
                        <h2 class="badge-left">✅ Con LEFT JOIN priorities_join (Nuestra App)</h2>
                        <p><strong>Total filas devueltas: ${leftJoinResults.length}</strong> (Conserva todas las tareas, rellenando con NULL las que no tienen urgencia).</p>
                        <table>
                            <tr><th>ID</th><th>Tarea</th><th>Prioridad</th></tr>
                            ${leftJoinResults.map(i => `<tr><td>${i.id}</td><td>${i.name}</td><td class="${i.prioridad.includes('NULL') ? 'null-val' : ''}">${i.prioridad}</td></tr>`).join("")}
                        </table>
                    </div>
                </div>

                <a href="/" class="back-btn">⬅ Volver a la To-Do List</a>
            </body>
            </html>
        `);
    } catch (err) {
        console.error("Error en comparativa:", err);
        res.status(500).send("Error al generar la comparativa: " + err.message);
    }
});

// RUTA 3: GET /about (Página estática informativa)
app.get("/about", (req, res) => {
    res.render("about");
});

// RUTA 4: GET /:customListName (Listas personalizadas dinámicas - SIEMPRE AL FINAL)
app.get("/:customListName", async (req, res) => {
    const customListName = _.capitalize(req.params.customListName);
    const [allLists] = await pool.query("SELECT name FROM lists_join ORDER BY name ASC");

    try {
        const [lists] = await pool.query("SELECT * FROM lists_join WHERE name = ?", [customListName]);

        if (lists.length === 0) {
            const [insertResult] = await pool.query("INSERT INTO lists_join (name) VALUES (?)", [customListName]);
            const listId = insertResult.insertId;

            for (const item of defaultItems) {
                await pool.query(
                    "INSERT INTO items_join (name, list_id, priority_id) VALUES (?, ?, ?)",
                    [item.name, listId, item.priority_id]
                );
            }
            res.redirect("/" + customListName);
        } else {
            const items = await getItemsWithJoins(customListName);
            const priorities = await getAllPriorities();

            res.render("list", { 
                listTitle: customListName, 
                newListItems: items,
                priorities: priorities,
                allLists: allLists   //variable añadida
            });
        }
    } catch (err) {
        console.error("Error en GET /:customListName:", err);
        res.status(500).send("Error al buscar la lista: " + err.message);
    }
});

// RUTA 5: POST / (Crear tarea con prioridad seleccionada)
app.post("/", async (req, res) => {
    const itemName = req.body.newItem;
    const listName = req.body.list;
    const priorityId = req.body.priorityId ? parseInt(req.body.priorityId, 10) : null;

    try {
        let [lists] = await pool.query("SELECT id FROM lists_join WHERE name = ?", [listName]);
        let listId;

        if (lists.length === 0) {
            const [insertResult] = await pool.query("INSERT INTO lists_join (name) VALUES (?)", [listName]);
            listId = insertResult.insertId;
        } else {
            listId = lists[0].id;
        }

        await pool.query(
            "INSERT INTO items_join (name, list_id, priority_id) VALUES (?, ?, ?)",
            [itemName, listId, priorityId]
        );

        if (listName === "Today") {
            res.redirect("/");
        } else {
            res.redirect("/" + listName);
        }
    } catch (err) {
        console.error("Error al guardar la tarea:", err);
        res.status(500).send("Error al guardar la tarea con urgencia: " + err.message);
    }
});

// RUTA 6: POST /delete (Eliminar tarea por su ID)
app.post("/delete", async (req, res) => {
    const checkedItemId = req.body.checkbox;
    const listName = req.body.listName;

    try {
        await pool.query("DELETE FROM items_join WHERE id = ?", [checkedItemId]);

        if (listName === "Today") {
            res.redirect("/");
        } else {
            res.redirect("/" + listName);
        }
    } catch (err) {
        console.error("Error al eliminar la tarea:", err);
        res.status(500).send("Error al eliminar la tarea: " + err.message);
    }
});

// ==============================================================================
// 5. Arranque del Servidor
// ==============================================================================
const PORT = process.env.PORT || 3000;

async function startServer() {
    try {
        await initializeDB();
        app.listen(PORT, function () {
            console.log(`🚀 Servidor con INNER y LEFT JOINs corriendo en el puerto ${PORT}`);
            console.log(`📊 Laboratorio didáctico disponible en: http://localhost:${PORT}/comparativa-joins`);
        });
    } catch (err) {
        console.error("❌ Error al arrancar:", err);
        process.exit(1);
    }
}

startServer();
