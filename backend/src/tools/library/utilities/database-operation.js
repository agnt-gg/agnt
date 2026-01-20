import BaseAction from '../BaseAction.js';
import db from '../../../models/database/index.js';

class DatabaseOperation extends BaseAction {
  static schema = {
    title: 'Database Operation',
    category: 'utility',
    type: 'database-operation',
    icon: 'database',
    description: 'This utility node performs database operations on user-specific data.',
    parameters: {
      operation: {
        type: 'string',
        inputType: 'select',
        options: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
        description: 'The type of database operation to perform',
      },
      tableName: {
        type: 'string',
        inputType: 'text',
        description: 'The name of the virtual table to operate on',
      },
      columns: {
        type: 'string',
        inputType: 'text',
        description: 'Comma-separated list of columns (for SELECT, INSERT, UPDATE)',
        conditional: {
          field: 'operation',
          value: ['SELECT', 'INSERT', 'UPDATE'],
        },
      },
      condition: {
        type: 'string',
        inputType: 'text',
        description: 'WHERE clause for the operation (for SELECT, UPDATE, DELETE)',
        conditional: {
          field: 'operation',
          value: ['SELECT', 'UPDATE', 'DELETE'],
        },
      },
      values: {
        type: 'string',
        inputType: 'textarea',
        description: 'Comma-separated list of values (for INSERT, UPDATE)',
        conditional: {
          field: 'operation',
          value: ['INSERT', 'UPDATE', 'DELETE'],
        },
      },
    },
    outputs: {
      success: {
        type: 'boolean',
        description: 'Indicates whether the database operation was successful',
      },
      result: {
        type: 'array',
        description: 'The data returned by the database operation (for SELECT)',
      },
      affectedRows: {
        type: 'number',
        description: 'The number of rows affected by the operation (for INSERT, UPDATE, DELETE)',
      },
      error: {
        type: 'string',
        description: 'Error message if the database operation failed',
      },
    },
  };

  constructor() {
    super('database-operation');
    this.workflowEngine = null;
  }
  async execute(params, inputData, workflowEngine) {
    this.workflowEngine = workflowEngine;
    try {
      this.validateParams(params);

      console.log(params);

      const { operation, tableName, columns, values, condition } = params;
      const userId = workflowEngine.userId; // Assume this method exists to get the current user's ID

      let result;

      switch (operation.toUpperCase()) {
        case 'SELECT':
          result = await this.select(userId, tableName, columns, condition);
          return { success: true, result };

        case 'INSERT':
          result = await this.insert(userId, tableName, columns, values);
          return { success: true, affectedRows: result.changes };

        case 'UPDATE':
          result = await this.update(userId, tableName, columns, values, condition);
          return { success: true, affectedRows: result.affectedRows };

        case 'DELETE':
          result = await this.delete(userId, tableName, condition, values);
          return { success: true, affectedRows: result.affectedRows };

        default:
          throw new Error('Invalid operation');
      }
    } catch (error) {
      console.error('Error in DatabaseOperation:', error);
      return { success: false, error: error.message };
    }
  }
  validateParams(params) {
    const { operation, tableName } = params;
    if (!operation || !tableName) {
      throw new Error('Operation and tableName are required parameters');
    }
  }
  async select(userId, tableName, columns, condition) {
    try {
      let sql;
      let params = [userId, tableName];
      let whereClause = '';
      let orderByClause = '';

      if (columns === '*') {
        // If '*' is specified, select all columns
        sql = `SELECT * FROM user_data WHERE user_id = ? AND table_name = ?`;
      } else {
        // Otherwise, select specific columns from the data JSON
        const columnArray = columns.split(',').map((col) => col.trim());
        const columnSelects = columnArray.map((col) => `json_extract(data, '$.${col}') as ${col}`).join(', ');
        sql = `SELECT id, user_id, table_name, ${columnSelects}, created_at, updated_at FROM user_data WHERE user_id = ? AND table_name = ?`;
      }

      if (condition) {
        // Process condition to handle virtual columns
        condition = this.processCondition(condition);

        // Split condition into WHERE and ORDER BY parts
        const parts = condition.split(/\b(ORDER BY|LIMIT|OFFSET)\b/i);
        whereClause = parts[0].trim();
        orderByClause = parts.slice(1).join(' ').trim();

        if (whereClause) {
          sql += ` AND (${whereClause})`;
        }
      }

      if (orderByClause) {
        // Automatically convert created_at and updated_at to datetime in ORDER BY clause
        orderByClause = orderByClause.replace(/\b(created_at|updated_at)\b/gi, 'datetime($1)');
        sql += ` ${orderByClause}`;
      }

      console.log('Final SQL query:', sql); // For debugging

      const results = await this.runSelectQuery(sql, params);

      // If '*' was selected, parse the JSON data
      if (columns === '*') {
        return results.map((row) => ({
          ...row,
          data: JSON.parse(row.data),
        }));
      } else {
        // For specific columns, only return the requested columns
        const columnArray = columns.split(',').map((col) => col.trim());
        return results.map((row) => {
          const filteredRow = {};
          columnArray.forEach((col) => {
            filteredRow[col] = row[col];
          });
          return filteredRow;
        });
      }
    } catch (error) {
      console.error('Error in select operation:', error);
      throw error;
    }
  }
  runSelectQuery(sql, params) {
    return new Promise((resolve, reject) => {
      db.all(sql, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  }
  runModifyQuery(sql, params) {
    return new Promise((resolve, reject) => {
      db.run(sql, params, function (err) {
        if (err) reject(err);
        else resolve(this);
      });
    });
  }
  // async insert(userId, tableName, columns, values) {
  //   try {
  //     const columnArray = columns.split(",").map((col) => col.trim());
  //     const valueArray = values.split(",").map((val) => val.trim());

  //     if (columnArray.length !== valueArray.length) {
  //       throw new Error("Number of columns does not match number of values");
  //     }

  //     const data = {};
  //     for (let i = 0; i < columnArray.length; i++) {
  //       if (
  //         valueArray[i] !== "true" &&
  //         valueArray[i] !== "false" &&
  //         valueArray[i] !== "null" &&
  //         isNaN(valueArray[i])
  //       ) {
  //         data[columnArray[i]] = valueArray[i];
  //       } else {
  //         data[columnArray[i]] = JSON.parse(valueArray[i]);
  //       }
  //     }

  //     const sql = `INSERT INTO user_data (id, user_id, table_name, data) VALUES (?, ?, ?, ?)`;
  //     const params = [this.generateId(), userId, tableName, JSON.stringify(data)];

  //     console.log("Insert SQL query:", sql);  // For debugging
  //     console.log("Insert params:", params);  // For debugging

  //     const result = await this.runModifyQuery(sql, params);
  //     return { success: true, affectedRows: result.changes, insertId: params[0] };
  //   } catch (error) {
  //     console.error("Error in insert operation:", error);
  //     throw error;
  //   }
  // }
  async insert(userId, tableName, columns, values) {
    try {
      const columnArray = columns.split(',').map((col) => col.trim());

      // Use robust parser for values
      const valueArray = this.parseValues(values);

      if (columnArray.length !== valueArray.length) {
        throw new Error(`Number of columns (${columnArray.length}) does not match number of values (${valueArray.length})`);
      }

      const data = {};
      for (let i = 0; i < columnArray.length; i++) {
        let value = valueArray[i];

        // Handle SQL-style single quotes
        if (value.startsWith("'") && value.endsWith("'") && value.length >= 2) {
          value = value.slice(1, -1);
          // Assume string if singled quoted
          data[columnArray[i]] = value;
          continue;
        }

        // Try to parse the value as JSON
        try {
          value = JSON.parse(value);
        } catch (e) {
          // If parsing fails, use the original string value
        }

        // Stringify arrays or objects
        if (Array.isArray(value) || (typeof value === 'object' && value !== null)) {
          value = JSON.stringify(value);
        }

        data[columnArray[i]] = value;
      }

      const sql = `INSERT INTO user_data (id, user_id, table_name, data) VALUES (?, ?, ?, ?)`;
      const params = [this.generateId(), userId, tableName, JSON.stringify(data)];

      console.log('Insert SQL query:', sql); // For debugging
      console.log('Insert params:', params); // For debugging

      const result = await this.runModifyQuery(sql, params);
      return { success: true, affectedRows: result.changes, insertId: params[0] };
    } catch (error) {
      console.error('Error in insert operation:', error);
      throw error;
    }
  }
  async update(userId, tableName, columns, values, condition) {
    try {
      const columnArray = columns.split(',').map((col) => col.trim());
      // Use robust parser for values
      const valueArray = this.parseValues(values);

      if (columnArray.length !== valueArray.length) {
        throw new Error('Number of columns does not match number of values');
      }

      const updateData = {};
      for (let i = 0; i < columnArray.length; i++) {
        let value = valueArray[i];

        // Handle SQL-style single quotes
        if (value.startsWith("'") && value.endsWith("'") && value.length >= 2) {
          value = value.slice(1, -1);
          updateData[columnArray[i]] = value;
          continue;
        }

        // Try to parse JSON
        try {
          value = JSON.parse(value);
        } catch (e) {
          // use original
        }

        updateData[columnArray[i]] = value;
      }

      let sql = `UPDATE user_data SET data = json_patch(data, ?), updated_at = CURRENT_TIMESTAMP WHERE user_id = ? AND table_name = ?`;
      let params = [JSON.stringify(updateData), userId, tableName];

      if (condition) {
        // Use parameterized query for the id condition
        const parts = condition.split('=');
        let conditionColumn = parts[0].trim();
        let conditionValue = parts.length > 1 ? parts[1].trim() : '';

        // Process the column name for virtual columns
        conditionColumn = this.processCondition(conditionColumn);

        sql += ` AND ${conditionColumn} = ?`;

        // Strip quotes from value if present, as parameter binding handles types
        if ((conditionValue.startsWith("'") && conditionValue.endsWith("'")) || (conditionValue.startsWith('"') && conditionValue.endsWith('"'))) {
          conditionValue = conditionValue.slice(1, -1);
        }

        params.push(conditionValue);
      }

      console.log('Update SQL query:', sql); // For debugging
      console.log('Update params:', params); // For debugging

      const result = await this.runModifyQuery(sql, params);
      return { affectedRows: result.changes };
    } catch (error) {
      console.error('Error in update operation:', error);
      throw error;
    }
  }
  async delete(userId, tableName, condition, values) {
    try {
      let sql = `DELETE FROM user_data WHERE user_id = ? AND table_name = ?`;
      let params = [userId, tableName];

      if (condition) {
        // Process condition for virtual columns
        const processedCondition = this.processCondition(condition);
        sql += ` AND (${processedCondition})`;

        if (values) {
          params.push(values);
        }
      }

      console.log('Delete SQL query:', sql); // For debugging
      console.log('Delete params:', params); // For debugging

      const result = await this.runModifyQuery(sql, params);
      return { affectedRows: result.changes };
    } catch (error) {
      console.error('Error in delete operation:', error);
      throw error;
    }
  }
  generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  }

  parseValues(text) {
    if (!text) return [];

    const values = [];
    let current = '';
    let inSingle = false;
    let inDouble = false;
    let bracketDepth = 0;

    for (let i = 0; i < text.length; i++) {
      const char = text[i];

      if (inSingle) {
        if (char === "'") inSingle = false;
        current += char;
      } else if (inDouble) {
        if (char === '"') inDouble = false;
        current += char;
      } else {
        if (char === "'") {
          inSingle = true;
          current += char;
        } else if (char === '"') {
          inDouble = true;
          current += char;
        } else if (char === '[') {
          bracketDepth++;
          current += char;
        } else if (char === ']') {
          bracketDepth--;
          current += char;
        } else if (char === ',' && bracketDepth === 0) {
          values.push(current.trim());
          current = '';
        } else {
          current += char;
        }
      }
    }
    values.push(current.trim());
    return values;
  }

  processCondition(condition) {
    if (!condition) return condition;

    // Regex matches single-quoted strings OR words
    // We ignore strings (matched by first part of regex) and process words (second part)
    return condition.replace(/'[^']*'|\b([a-zA-Z_]\w*)\b/g, (match, word) => {
      // If it's a quoted string (match starts with '), return as is
      if (match.startsWith("'")) return match;

      // It's a word. Check if it is a keyword or system column.
      const systemColumns = ['id', 'user_id', 'table_name', 'created_at', 'updated_at', 'data'];
      const sqlKeywords = [
        'SELECT',
        'FROM',
        'WHERE',
        'ORDER',
        'BY',
        'ASC',
        'DESC',
        'LIMIT',
        'OFFSET',
        'AND',
        'OR',
        'NOT',
        'IN',
        'IS',
        'NULL',
        'LIKE',
        'VALUES',
        'INSERT',
        'UPDATE',
        'DELETE',
        'TRUE',
        'FALSE',
        'JSON_EXTRACT',
        'DATETIME',
        'COUNT',
        'SUM',
        'AVG',
        'MIN',
        'MAX',
        'JSON_PATCH',
      ];

      if (systemColumns.includes(match)) return match;
      if (sqlKeywords.includes(match.toUpperCase())) return match;

      // Also check if it looks like a pure number (regex \w includes digits but check safe side)
      if (!isNaN(match)) return match;

      return `json_extract(data, '$.${match}')`;
    });
  }
}

export default new DatabaseOperation();
