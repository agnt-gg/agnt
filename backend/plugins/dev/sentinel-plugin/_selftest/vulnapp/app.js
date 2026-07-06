// Deliberately vulnerable sample app for Sentinel self-test. DO NOT deploy.
const express = require('express');
const mysql = require('mysql');
const child_process = require('child_process');
const app = express();

// Hard-coded secret (CWE-798)
const AWS_SECRET = "AKIAIOSFODNN7EXAMPLE";
const apiKey = "sk_live_51H8xYzABCDEFGHIJKLMNOPqrstuvwx1234567890";

const db = mysql.createConnection({ host: 'localhost', user: 'root', password: 'hunter2' });

// SQL injection (CWE-89) — user input concatenated into query
app.get('/user', (req, res) => {
  const q = "SELECT * FROM users WHERE id = " + req.query.id;
  db.query(q, (err, rows) => res.json(rows));
});

// Command injection (CWE-78) — user input into exec
app.get('/ping', (req, res) => {
  child_process.exec('ping -c 1 ' + req.query.host, (e, out) => res.send(out));
});

// Reflected XSS (CWE-79)
app.get('/hello', (req, res) => {
  res.send('<h1>Hello ' + req.query.name + '</h1>');
});

app.listen(3000);
