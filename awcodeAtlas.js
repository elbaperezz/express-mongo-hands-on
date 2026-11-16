//jshint esversion:8

// Import necessary NPM modules required for the application
const express = require("express");
const bodyParser = require("body-parser");
const mongoose = require("mongoose");
const _ = require("lodash");

const app = express();

app.set('view engine', 'ejs');
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static("public"));

// =====================================================================
// 1. CONEXIÓN SEGURA CON VARIABLE DE ENTORNO
// La cadena de conexión YA NO está escrita en el código (antes había un
// usuario y contraseña a la vista de todo GitHub).
// - En Render: se define en Environment Variables -> MONGODB_URI
// - En local: crea un archivo .env (que NO se sube a GitHub) y arranca con
//     node --env-file=.env awcodeAtlas.js
// =====================================================================
const MONGODB_ATLAS_URI = process.env.MONGODB_URI;

if (!MONGODB_ATLAS_URI) {
    console.error("❌ Falta la variable de entorno MONGODB_URI. Revisa tu .env o la configuración de Render.");
    process.exit(1);
}

// Las opciones useNewUrlParser / useUnifiedTopology ya no son necesarias
// en versiones modernas de Mongoose, así que se eliminan.
mongoose.connect(MONGODB_ATLAS_URI)
    .then(() => console.log("✅ Conectado a MongoDB Atlas"))
    .catch(err => console.error("❌ Error conectando a MongoDB Atlas:", err.message));

// ---------------------------------------------------------------------
// Modelos
// ---------------------------------------------------------------------
const itemsSchema = {
    name: String
};
const Item = mongoose.model("Item", itemsSchema);

const item1 = new Item({ name: "Welcome to your todolist!" });
const item2 = new Item({ name: "Hit the + button to add a new item." });
const item3 = new Item({ name: "<-- Hit this to delete an item." });
const defaultItems = [item1, item2, item3];

const listSchema = {
    name: String,
    items: [itemsSchema]
};
const List = mongoose.model("List", listSchema);

// ---------------------------------------------------------------------
// Rutas fijas: van ANTES de "/:customListName"; si no, Express las
// interpretaría como nombres de lista (p. ej. crearía una lista "About"
// o "Favicon.ico").
// ---------------------------------------------------------------------
app.get("/favicon.ico", (req, res) => res.status(204).end());

app.get("/about", (req, res) => {
    res.render("about");
});

// ---------------------------------------------------------------------
// 2. RUTA PRINCIPAL "/" -> consulta todas las listas para el desplegable
// ---------------------------------------------------------------------
app.get("/", async (req, res) => {
    try {
        const foundItems = await Item.find({});
        if (foundItems.length === 0) {
            await Item.insertMany(defaultItems);
            return res.redirect("/");
        }

        const allLists = await List.find({}, "name"); // 👈 todas las listas (solo el nombre)

        res.render("list", {
            listTitle: "Today",
            newListItems: foundItems,
            allLists: allLists // 👈 se envía a la vista
        });
    } catch (err) {
        console.log(err);
        res.status(500).send("Error retrieving items");
    }
});

// ---------------------------------------------------------------------
// 2b. LISTAS PERSONALIZADAS "/:customListName" -> también envía allLists
// ---------------------------------------------------------------------
app.get("/:customListName", async (req, res) => {
    const customListName = _.capitalize(req.params.customListName);

    try {
        const foundList = await List.findOne({ name: customListName });
        if (!foundList) {
            const list = new List({
                name: customListName,
                items: defaultItems
            });
            await list.save();
            return res.redirect("/" + customListName);
        }

        const allLists = await List.find({}, "name"); // 👈 todas las listas

        res.render("list", {
            listTitle: foundList.name,
            newListItems: foundList.items,
            allLists: allLists // 👈 se envía a la vista
        });
    } catch (err) {
        console.log(err);
        res.status(500).send("Error finding the list");
    }
});

// ---------------------------------------------------------------------
// Añadir tarea
// ---------------------------------------------------------------------
app.post("/", async (req, res) => {
    const itemName = req.body.newItem;
    const listName = req.body.list;
    const item = new Item({ name: itemName });

    try {
        if (listName === "Today") {
            await item.save();
            res.redirect("/");
        } else {
            const foundList = await List.findOne({ name: listName });
            foundList.items.push(item);
            await foundList.save();
            res.redirect("/" + listName);
        }
    } catch (err) {
        console.log(err);
        res.status(500).send("Error saving the item");
    }
});

// ---------------------------------------------------------------------
// Borrar tarea
// ---------------------------------------------------------------------
app.post("/delete", async (req, res) => {
    const checkedItemId = req.body.checkbox;
    const listName = req.body.listName;

    try {
        if (listName === "Today") {
            await Item.findByIdAndDelete(checkedItemId);
            res.redirect("/");
        } else {
            await List.findOneAndUpdate(
                { name: listName },
                { $pull: { items: { _id: checkedItemId } } }
            );
            res.redirect("/" + listName);
        }
    } catch (err) {
        console.log(err);
        res.status(500).send("Error deleting the item");
    }
});

// Render asigna el puerto con la variable PORT
const PORT = process.env.PORT || 3000;

app.listen(PORT, function () {
    console.log("Server started on port", PORT);
});
