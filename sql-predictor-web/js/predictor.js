/**
 * SQLPredictor:
 * - Lee un diccionario SQL (.txt / .sql)
 * - Extrae tablas y columnas desde sentencias CREATE TABLE
 * - Entrena un modelo de lenguaje N-grama (Unigramas, Bigramas y Trigramas)
 * - Predice el siguiente token o completa la palabra actual según contexto y alias
 */

class SQLPredictor {
  constructor() {
    this.sqlKeywords = new Set([
      "SELECT", "FROM", "WHERE", "INSERT", "INTO", "VALUES", "UPDATE", "SET",
      "DELETE", "CREATE", "TABLE", "INNER", "LEFT", "RIGHT", "JOIN", "ON",
      "AND", "OR", "NOT", "ORDER", "BY", "GROUP", "HAVING", "LIMIT", "AS",
      "PRIMARY", "KEY", "FOREIGN", "REFERENCES", "INT", "VARCHAR", "DATE",
      "DECIMAL", "COUNT", "SUM", "AVG", "MIN", "MAX", "DISTINCT", "NULL"
    ]);
    this.reset();
  }

  reset() {
    this.schema = {}; // { nombre_tabla: [col1, col2, ...] }
    this.allColumns = new Set();
    this.unigrams = new Map(); // norm -> { display, count }
    this.bigrams = new Map();  // norm1 -> Map(norm2 -> { display, count })
    this.trigrams = new Map(); // "norm1 norm2" -> Map(norm3 -> { display, count })
    this.stats = {
      statements: 0,
      vocab: 0,
      bigrams: 0,
      trigrams: 0
    };
  }

  /**
   * Entrena el predictor a partir del texto del diccionario.
   */
  train(rawText) {
    this.reset();
    if (!rawText || typeof rawText !== "string") return this.stats;

    // 1. Quitar comentarios de línea (-- ...)
    const cleaned = rawText.replace(/--.*$/gm, "");

    // 2. Extraer esquema desde CREATE TABLE
    this.extractSchema(cleaned);

    // 3. Dividir en sentencias por ';'
    const statements = cleaned
      .split(";")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    this.stats.statements = statements.length;

    for (const stmt of statements) {
      const tokens = this.tokenize(stmt);
      if (tokens.length === 0) continue;

      for (let i = 0; i < tokens.length; i++) {
        const curr = tokens[i];
        const currKey = this.normalize(curr);

        this.incrementMap(this.unigrams, currKey, curr);

        if (i >= 1) {
          const prev1 = this.normalize(tokens[i - 1]);
          if (!this.bigrams.has(prev1)) this.bigrams.set(prev1, new Map());
          this.incrementMap(this.bigrams.get(prev1), currKey, curr);
        }

        if (i >= 2) {
          const prev2Key = `${this.normalize(tokens[i - 2])} ${this.normalize(tokens[i - 1])}`;
          if (!this.trigrams.has(prev2Key)) this.trigrams.set(prev2Key, new Map());
          this.incrementMap(this.trigrams.get(prev2Key), currKey, curr);
        }
      }
    }

    this.stats.vocab = this.unigrams.size;
    this.stats.bigrams = this.bigrams.size;
    this.stats.trigrams = this.trigrams.size;
    return this.stats;
  }

  extractSchema(sqlText) {
    const createRegex = /CREATE\s+TABLE\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(([\s\S]*?)\)\s*;/gi;
    let match;

    while ((match = createRegex.exec(sqlText)) !== null) {
      const tableName = match[1].toLowerCase();
      const body = match[2];
      const columns = [];

      const lines = body.split(",");
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        if (/^(FOREIGN|PRIMARY|CONSTRAINT|UNIQUE|CHECK|KEY)\b/i.test(trimmed)) continue;

        const colMatch = trimmed.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s+/);
        if (colMatch) {
          const colName = colMatch[1].toLowerCase();
          columns.push(colName);
          this.allColumns.add(colName);
        }
      }

      this.schema[tableName] = columns;
    }
  }

  tokenize(text) {
    // Captura strings entre comillas simples, identificadores con punto (c.nombre),
    // números decimales, identificadores normales y operadores relevantes
    const regex = /'[^']*'|[a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)?|\d+(?:\.\d+)?|[*,()=]/g;
    const matches = text.match(regex);
    return matches ? matches : [];
  }

  normalize(token) {
    if (token.startsWith("'")) return token;
    return token.toLowerCase();
  }

  preferredDisplay(token) {
    if (token.startsWith("'")) return token;
    const upper = token.toUpperCase();
    if (this.sqlKeywords.has(upper)) return upper;
    return token;
  }

  incrementMap(map, key, rawToken) {
    const display = this.preferredDisplay(rawToken);
    if (map.has(key)) {
      const entry = map.get(key);
      entry.count += 1;
      // Preferir mayúsculas si es palabra clave SQL
      if (this.sqlKeywords.has(display)) entry.display = display;
    } else {
      map.set(key, { display, count: 1 });
    }
  }

  classifyToken(token) {
    if (token.startsWith("'")) return "value";
    const upper = token.toUpperCase();
    if (this.sqlKeywords.has(upper)) return "keyword";

    const lower = token.toLowerCase();
    if (this.schema[lower]) return "table";

    if (lower.includes(".")) {
      const colPart = lower.split(".")[1];
      if (this.allColumns.has(colPart)) return "column";
    }
    if (this.allColumns.has(lower)) return "column";

    return "ngram";
  }

  /**
   * Detecta alias de tablas en la consulta actual (ej. "clientes c", "pedidos p")
   */
  extractAliases(queryText) {
    const aliases = {};
    const tableNames = Object.keys(this.schema);
    if (tableNames.length === 0) return aliases;

    const aliasRegex = /(?:FROM|JOIN|UPDATE|INTO)\s+([a-zA-Z_][a-zA-Z0-9_]*)(?:\s+(?:AS\s+)?([a-zA-Z_][a-zA-Z0-9_]*))?/gi;
    let match;
    while ((match = aliasRegex.exec(queryText)) !== null) {
      const table = match[1].toLowerCase();
      const alias = match[2] ? match[2].toLowerCase() : null;
      if (this.schema[table] && alias && !this.sqlKeywords.has(alias.toUpperCase())) {
        aliases[alias] = table;
      }
    }
    return aliases;
  }

  /**
   * Genera predicciones a partir del texto antes del cursor.
   * Devuelve: { mode, partial, predictions: [...] }
   */
  predict(textBeforeCursor, maxResults = 8) {
    // Tomar únicamente la sentencia actual (después del último ';')
    const lastSemi = textBeforeCursor.lastIndexOf(";");
    const currentStmt = lastSemi >= 0 ? textBeforeCursor.slice(lastSemi + 1) : textBeforeCursor;

    const endsWithSpace = /[\s,(=]$/.test(currentStmt) || currentStmt.length === 0;
    const aliases = this.extractAliases(currentStmt);

    // 1. Verificar si está escribiendo un alias con punto: ej. "c." o "c.nom"
    const aliasDotMatch = currentStmt.match(/([a-zA-Z_][a-zA-Z0-9_]*)\.([a-zA-Z0-9_]*)$/);
    if (aliasDotMatch) {
      const prefixAlias = aliasDotMatch[1].toLowerCase();
      const colPartial = aliasDotMatch[2].toLowerCase();
      const targetTable = aliases[prefixAlias] || (this.schema[prefixAlias] ? prefixAlias : null);

      if (targetTable && this.schema[targetTable]) {
        const cols = this.schema[targetTable]
          .filter((c) => c.startsWith(colPartial))
          .map((c, idx, arr) => ({
            token: `${aliasDotMatch[1]}.${c}`,
            replaceLength: aliasDotMatch[0].length,
            type: "column",
            probability: Math.round(100 / Math.max(arr.length, 1)),
            source: `esquema (${targetTable})`
          }));

        return {
          mode: "alias",
          partial: aliasDotMatch[0],
          contextLabel: `Columnas de ${targetTable}`,
          predictions: cols.slice(0, maxResults)
        };
      }
    }

    // 2. Separar contexto previo y palabra parcial actual
    let contextText = currentStmt;
    let partial = "";

    if (!endsWithSpace) {
      const partialMatch = currentStmt.match(/('[^']*|[a-zA-Z0-9_.]+)$/);
      if (partialMatch) {
        partial = partialMatch[1];
        contextText = currentStmt.slice(0, currentStmt.length - partial.length);
      }
    }

    const contextTokens = this.tokenize(contextText);
    const prev1 = contextTokens.length >= 1 ? this.normalize(contextTokens[contextTokens.length - 1]) : null;
    const prev2 = contextTokens.length >= 2 ? this.normalize(contextTokens[contextTokens.length - 2]) : null;

    const scoreMap = new Map(); // normKey -> { display, score, source }
    const addScore = (key, display, points, source) => {
      if (scoreMap.has(key)) {
        const item = scoreMap.get(key);
        item.score += points;
        if (source === "trigrama") item.source = "trigrama";
      } else {
        scoreMap.set(key, { display, score: points, source });
      }
    };

    // 3. Predicción por Trigramas (peso alto)
    if (prev2 && prev1) {
      const triKey = `${prev2} ${prev1}`;
      const triCandidates = this.trigrams.get(triKey);
      if (triCandidates) {
        for (const [k, v] of triCandidates.entries()) {
          addScore(k, v.display, v.count * 6.0, "trigrama");
        }
      }
    }

    // 4. Predicción por Bigramas (peso medio)
    if (prev1) {
      const biCandidates = this.bigrams.get(prev1);
      if (biCandidates) {
        for (const [k, v] of biCandidates.entries()) {
          addScore(k, v.display, v.count * 2.5, "bigrama");
        }
      }
    }

    // 5. Refuerzo contextual basado en el esquema SQL
    if (prev1) {
      if (["from", "into", "update", "join"].includes(prev1)) {
        for (const table of Object.keys(this.schema)) {
          addScore(table, table, 18, "esquema");
        }
      } else if (["select", "where", "set", "on", "and", "or"].includes(prev1)) {
        for (const col of this.allColumns) {
          addScore(col, col, 4, "esquema");
        }
      }
    }

    // 6. Respaldo por vocabulario (unigramas + palabras clave) cuando hay texto parcial o está vacío
    if (partial.length > 0 || scoreMap.size === 0) {
      for (const [k, v] of this.unigrams.entries()) {
        if (!scoreMap.has(k)) {
          addScore(k, v.display, v.count * 0.2, "diccionario");
        }
      }
      for (const kw of this.sqlKeywords) {
        const k = kw.toLowerCase();
        if (!scoreMap.has(k)) {
          addScore(k, kw, 0.15, "SQL");
        }
      }
    }

    // 7. Filtrar por prefijo si el usuario está escribiendo un token
    const partialLower = partial.toLowerCase();
    let candidates = Array.from(scoreMap.entries())
      .map(([key, item]) => ({
        key,
        token: item.display,
        score: item.score,
        source: item.source,
        type: this.classifyToken(item.display),
        replaceLength: partial.length
      }))
      .filter((item) => {
        if (!partialLower) return true;
        return item.token.toLowerCase().startsWith(partialLower) && item.token.toLowerCase() !== partialLower;
      });

    // Ordenar por puntaje descendente
    candidates.sort((a, b) => b.score - a.score);
    candidates = candidates.slice(0, maxResults);

    // Normalizar a porcentajes relativos entre las mejores opciones
    const totalScore = candidates.reduce((acc, c) => acc + c.score, 0) || 1;
    const predictions = candidates.map((c) => ({
      token: c.token,
      replaceLength: c.replaceLength,
      type: c.type,
      source: c.source,
      probability: Math.max(1, Math.round((c.score / totalScore) * 100))
    }));

    const contextLabel = prev2 && prev1
      ? `Contexto: "${prev2} ${prev1}"`
      : prev1
        ? `Contexto: "${prev1}"`
        : "Inicio de sentencia";

    return {
      mode: partial ? "complete" : "next",
      partial,
      contextLabel,
      predictions
    };
  }
}

window.SQLPredictor = SQLPredictor;
