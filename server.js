const express = require("express");
const session = require("express-session");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 3000;

const ROOT = __dirname;
const pub = path.join(ROOT, "public");

// ======================================================
// PERSISTENT STORAGE
// ======================================================

const STORAGE_ROOT = process.env.STORAGE_ROOT || path.join(ROOT, "data");

const DATA = path.join(STORAGE_ROOT, "content.json");
const ADMIN = path.join(STORAGE_ROOT, "admin.json");

const uploadsDir = path.join(STORAGE_ROOT, "uploads");
const imgDir = path.join(uploadsDir, "images");
const docDir = path.join(uploadsDir, "docs");

// Files from GitHub used as initial data
const SEED_DATA = path.join(ROOT, "data", "content.json");
const SEED_ADMIN = path.join(ROOT, "data", "admin.json");
const SEED_UPLOADS = path.join(pub, "uploads");

// Create persistent directories
for (const dir of [STORAGE_ROOT, uploadsDir, imgDir, docDir]) {
  fs.mkdirSync(dir, { recursive: true });
}

// ======================================================
// INITIAL MIGRATION TO PERSISTENT DISK
// ======================================================

// Copy existing content.json to persistent disk
if (!fs.existsSync(DATA)) {
  if (fs.existsSync(SEED_DATA)) {
    fs.copyFileSync(SEED_DATA, DATA);
    console.log("Initial content.json copied to persistent storage");
  }
}

// Copy existing admin.json to persistent disk
// This preserves the current admin login/password hash.
if (!fs.existsSync(ADMIN)) {
  if (fs.existsSync(SEED_ADMIN)) {
    fs.copyFileSync(SEED_ADMIN, ADMIN);
    console.log("Initial admin.json copied to persistent storage");
  } else {
    const defaultPassword =
      process.env.ADMIN_PASSWORD || "Lyceum2-Admin-2026!";

    const salt = crypto.randomBytes(16).toString("hex");

    const hash = crypto
      .scryptSync(defaultPassword, salt, 64)
      .toString("hex");

    fs.writeFileSync(
      ADMIN,
      JSON.stringify(
        {
          login: process.env.ADMIN_LOGIN || "admin",
          salt,
          hash
        },
        null,
        2
      ),
      "utf8"
    );

    console.log("New admin.json created in persistent storage");
  }
}

// Copy existing uploads to persistent disk on first startup
if (
  fs.existsSync(SEED_UPLOADS) &&
  fs.existsSync(uploadsDir) &&
  fs.readdirSync(uploadsDir).length === 0
) {
  fs.cpSync(SEED_UPLOADS, uploadsDir, {
    recursive: true
  });

  console.log("Existing uploads copied to persistent storage");
}

// If content.json still does not exist, create basic structure
if (!fs.existsSync(DATA)) {
  const initialContent = {
    site: {},
    news: [],
    photos: [],
    docs: [],
    needs: [],
    teachers: [],
    achievements: [],
    links: []
  };

  fs.writeFileSync(
    DATA,
    JSON.stringify(initialContent, null, 2),
    "utf8"
  );
}

// ======================================================
// DATA FUNCTIONS
// ======================================================

function read() {
  return JSON.parse(fs.readFileSync(DATA, "utf8"));
}

function write(data) {
  fs.writeFileSync(
    DATA,
    JSON.stringify(data, null, 2),
    "utf8"
  );
}

// ======================================================
// PASSWORD HASHING
// ======================================================

function hash(password, salt = crypto.randomBytes(16).toString("hex")) {
  return {
    salt,
    hash: crypto
      .scryptSync(password, salt, 64)
      .toString("hex")
  };
}

// ======================================================
// AUTH
// ======================================================

function auth(req, res, next) {
  if (req.session.user) {
    return next();
  }

  res.status(401).json({
    error: "Unauthorized"
  });
}

// ======================================================
// MIDDLEWARE
// ======================================================
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

app.set("trust proxy", 1);

app.use(
  session({
    secret:
      process.env.SESSION_SECRET ||
      "change-this-session-secret-before-production",

    resave: false,
    saveUninitialized: false,

    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production"
    }
  })
);

// ======================================================
// FILE UPLOADS
// ======================================================

const storage = (dir) =>
  multer({
    storage: multer.diskStorage({
      destination: dir,

      filename: (req, file, cb) => {
        cb(
          null,
          Date.now() +
            "-" +
            crypto.randomBytes(5).toString("hex") +
            path.extname(file.originalname).toLowerCase()
        );
      }
    }),

    limits: {
      fileSize: 25 * 1024 * 1024
    }
  });

const uploadImg = multer({
  storage: multer.diskStorage({
    destination: imgDir,

    filename: (req, file, cb) => {
      cb(
        null,
        Date.now() +
          "-" +
          crypto.randomBytes(5).toString("hex") +
          path.extname(file.originalname).toLowerCase()
      );
    }
  }),

  limits: {
    fileSize: 10 * 1024 * 1024
  }
});

const uploadDoc = storage(docDir);

// ======================================================
// API
// ======================================================

app.get("/api/content", (req, res) => {
  res.json(read());
});

app.get("/api/me", (req, res) => {
  res.json({
    loggedIn: !!req.session.user
  });
});

// ======================================================
// LOGIN
// ======================================================

app.post("/api/login", (req, res) => {
  try {
    const admin = JSON.parse(
      fs.readFileSync(ADMIN, "utf8")
    );

    const passwordHash = Buffer.from(
      hash(req.body.password, admin.salt).hash,
      "hex"
    );

    const savedHash = Buffer.from(
      admin.hash,
      "hex"
    );

    if (
      req.body.login === admin.login &&
      passwordHash.length === savedHash.length &&
      crypto.timingSafeEqual(passwordHash, savedHash)
    ) {
      req.session.user = admin.login;

      return res.json({
        ok: true
      });
    }

    res.status(401).json({
      error: "Неверный логин или пароль"
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: "Ошибка входа"
    });
  }
});

// ======================================================
// LOGOUT
// ======================================================

app.post("/api/logout", auth, (req, res) => {
  req.session.destroy(() => {
    res.json({
      ok: true
    });
  });
});

// ======================================================
// SITE SETTINGS
// ======================================================

app.put("/api/site", auth, (req, res) => {
  const data = read();

  data.site = {
    ...data.site,
    ...req.body
  };

  write(data);

  res.json(data.site);
});

// ======================================================
// COLLECTIONS
// ======================================================

const collections = [
  "news",
  "docs",
  "needs",
  "teachers",
  "achievements",
  "links"
];

for (const key of collections) {
  app.post("/api/" + key, auth, (req, res) => {
    const data = read();

    if (!Array.isArray(data[key])) {
      data[key] = [];
    }

    const item = {
      id: Date.now().toString(),
      ...req.body
    };

    data[key].unshift(item);

    write(data);

    res.json(item);
  });

  app.put("/api/" + key + "/:id", auth, (req, res) => {
    const data = read();

    if (!Array.isArray(data[key])) {
      return res.sendStatus(404);
    }

    const index = data[key].findIndex(
      (item) => item.id === req.params.id
    );

    if (index < 0) {
      return res.sendStatus(404);
    }

    data[key][index] = {
      ...data[key][index],
      ...req.body
    };

    write(data);

    res.json(data[key][index]);
  });
 app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

app.set("trust proxy", 1);

app.use(
  session({
    secret:
      process.env.SESSION_SECRET ||
      "change-this-session-secret-before-production",

    resave: false,
    saveUninitialized: false,

    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production"
    }
  })
);

// ======================================================
// FILE UPLOADS
// ======================================================

const storage = (dir) =>
  multer({
    storage: multer.diskStorage({
      destination: dir,

      filename: (req, file, cb) => {
        cb(
          null,
          Date.now() +
            "-" +
            crypto.randomBytes(5).toString("hex") +
            path.extname(file.originalname).toLowerCase()
        );
      }
    }),

    limits: {
      fileSize: 25 * 1024 * 1024
    }
  });

const uploadImg = multer({
  storage: multer.diskStorage({
    destination: imgDir,

    filename: (req, file, cb) => {
      cb(
        null,
        Date.now() +
          "-" +
          crypto.randomBytes(5).toString("hex") +
          path.extname(file.originalname).toLowerCase()
      );
    }
  }),

  limits: {
    fileSize: 10 * 1024 * 1024
  }
});

const uploadDoc = storage(docDir);

// ======================================================
// API
// ======================================================

app.get("/api/content", (req, res) => {
  res.json(read());
});

app.get("/api/me", (req, res) => {
  res.json({
    loggedIn: !!req.session.user
  });
});

// ======================================================
// LOGIN
// ======================================================

app.post("/api/login", (req, res) => {
  try {
    const admin = JSON.parse(
      fs.readFileSync(ADMIN, "utf8")
    );

    const passwordHash = Buffer.from(
      hash(req.body.password, admin.salt).hash,
      "hex"
    );

    const savedHash = Buffer.from(
      admin.hash,
      "hex"
    );

    if (
      req.body.login === admin.login &&
      passwordHash.length === savedHash.length &&
      crypto.timingSafeEqual(passwordHash, savedHash)
    ) {
      req.session.user = admin.login;

      return res.json({
        ok: true
      });
    }

    res.status(401).json({
      error: "Неверный логин или пароль"
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: "Ошибка входа"
    });
  }
});

// ======================================================
// LOGOUT
// ======================================================

app.post("/api/logout", auth, (req, res) => {
  req.session.destroy(() => {
    res.json({
      ok: true
    });
  });
});

// ======================================================
// SITE SETTINGS
// ======================================================

app.put("/api/site", auth, (req, res) => {
  const data = read();

  data.site = {
    ...data.site,
    ...req.body
  };

  write(data);

  res.json(data.site);
});

// ======================================================
// COLLECTIONS
// ======================================================

const collections = [
  "news",
  "docs",
  "needs",
  "teachers",
  "achievements",
  "links"
];

for (const key of collections) {
  app.post("/api/" + key, auth, (req, res) => {
    const data = read();

    if (!Array.isArray(data[key])) {
      data[key] = [];
    }

    const item = {
      id: Date.now().toString(),
      ...req.body
    };

    data[key].unshift(item);

    write(data);

    res.json(item);
  });

  app.put("/api/" + key + "/:id", auth, (req, res) => {
    const data = read();

    if (!Array.isArray(data[key])) {
      return res.sendStatus(404);
    }

    const index = data[key].findIndex(
      (item) => item.id === req.params.id
    );

    if (index < 0) {
      return res.sendStatus(404);
    }

    data[key][index] = {
      ...data[key][index],
      ...req.body
    };

    write(data);

    res.json(data[key][index]);
  });
app.delete("/api/" + key + "/:id", auth, (req, res) => {
    const data = read();

    if (!Array.isArray(data[key])) {
      return res.sendStatus(404);
    }

    data[key] = data[key].filter(
      (item) => item.id !== req.params.id
    );

    write(data);

    res.json({
      ok: true
    });
  });
}

// ======================================================
// PHOTO UPLOAD
// ======================================================

app.post(
  "/api/photo",
  auth,
  uploadImg.single("photo"),
  (req, res) => {
    try {
      const data = read();

      if (!req.file) {
        return res.status(400).json({
          error: "Файл не выбран"
        });
      }

      if (!Array.isArray(data.photos)) {
        data.photos = [];
      }

      const item = {
        id: Date.now().toString(),

        // URL remains exactly the same for the website
        url: "/uploads/images/" + req.file.filename,

        title:
          req.body.title ||
          req.file.originalname
      };

      data.photos.unshift(item);

      write(data);

      res.json(item);
    } catch (error) {
      console.error(error);

      res.status(500).json({
        error: "Ошибка загрузки фотографии"
      });
    }
  }
);

// ======================================================
// PHOTO DELETE
// ======================================================

app.delete(
  "/api/photo/:id",
  auth,
  (req, res) => {
    const data = read();

    if (!Array.isArray(data.photos)) {
      data.photos = [];
    }

    const photo = data.photos.find(
      (item) => item.id === req.params.id
    );

    if (photo) {
      try {
        const relativePath = photo.url.replace(
          /^\/uploads\//,
          ""
        );

        const filePath = path.join(
          uploadsDir,
          relativePath
        );

        fs.unlinkSync(filePath);
      } catch (error) {
        console.log(
          "Photo file could not be deleted:",
          error.message
        );
      }
    }

    data.photos = data.photos.filter(
      (item) => item.id !== req.params.id
    );

    write(data);

    res.json({
      ok: true
    });
  }
);

// ======================================================
// DOCUMENT UPLOAD
// ======================================================

app.post(
  "/api/document-upload",
  auth,
  uploadDoc.single("document"),
  (req, res) => {
    try {
      const data = read();

      if (!req.file) {
        return res.status(400).json({
          error: "Файл не выбран"
        });
      }

      if (!Array.isArray(data.docs)) {
        data.docs = [];
      }

      const item = {
        id: Date.now().toString(),

        title:
          req.body.title ||
          req.file.originalname,

        url: "/uploads/docs/" + req.file.filename
      };

      data.docs.unshift(item);

      write(data);

      res.json(item);
    } catch (error) {
      console.error(error);

      res.status(500).json({
        error: "Ошибка загрузки документа"
      });
    }
  }
);

// ======================================================
// CHANGE PASSWORD
// ======================================================

app.post("/api/password", auth, (req, res) => {
  try {
    const admin = JSON.parse(
      fs.readFileSync(ADMIN, "utf8")
    );

    let oldPasswordCorrect = false;

    // Allow environment password during initial setup
    if (
      process.env.ADMIN_PASSWORD &&
      req.body.old === process.env.ADMIN_PASSWORD
    ) {
      oldPasswordCorrect = true;
    }

    // Check current stored password
    if (!oldPasswordCorrect) {
      const currentHash = crypto
        .scryptSync(
          req.body.old,
          admin.salt,
          64
        )
        .toString("hex");

      oldPasswordCorrect =
        currentHash === admin.hash;
    }

    if (!oldPasswordCorrect) {
      return res.status(400).json({
        error: "Старий пароль невірний"
      });
    }

    const newPassword = hash(req.body.new);
fs.writeFileSync(
      ADMIN,
      JSON.stringify(
        {
          login: admin.login,
          ...newPassword
        },
        null,
        2
      ),
      "utf8"
    );

    res.json({
      ok: true
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: "Помилка зміни пароля"
    });
  }
});

// ======================================================
// SEO
// ======================================================

app.get("/robots.txt", (req, res) => {
  res
    .type("text")
    .send(
      "User-agent: *\n" +
        "Allow: /\n" +
        "Sitemap: " +
        req.protocol +
        "://" +
        req.get("host") +
        "/sitemap.xml"
    );
});

app.get("/sitemap.xml", (req, res) => {
  const base =
    req.protocol +
    "://" +
    req.get("host");

  res
    .type("application/xml")
    .send(<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${base}/</loc>
  </url>
  <url>
    <loc>${base}/admin</loc>
  </url>
</urlset>);
});

// ======================================================
// STATIC FILES
// ======================================================

// IMPORTANT:
// Persistent uploads are served from /var/data/uploads
app.use(
  "/uploads",
  express.static(uploadsDir)
);

// Normal website files
app.use(
  express.static(pub)
);

// Admin panel
app.get("/admin", (req, res) => {
  res.sendFile(
    path.join(pub, "admin.html")
  );
});

// SPA fallback
app.get("/{*splat}", (req, res) => {
  res.sendFile(
    path.join(pub, "index.html")
  );
});

// ======================================================
// START
// ======================================================

app.listen(PORT, () => {
  console.log(
    "Ліцей v3.3 Full: http://localhost:" +
      PORT
  );

  console.log(
    "Persistent storage:",
    STORAGE_ROOT
  );
});
 
