# Database Operation 🗄️

## Id

`database-operation`

## Description

This utility node performs database operations on user-specific data. It supports SELECT, INSERT, UPDATE, and DELETE operations on virtual tables.

## Tags

database, utility, data, storage, CRUD

## Input Parameters

### Required

- **operation** (string): The type of database operation to perform (`SELECT`, `INSERT`, `UPDATE`, `DELETE`)
- **tableName** (string): The name of the virtual table to operate on

### Optional

- **columns** (string) [SELECT, INSERT, UPDATE operations only]: Comma-separated list of columns
- **condition** (string) [SELECT, UPDATE, DELETE operations only]: WHERE clause for the operation
- **values** (string) [INSERT, UPDATE, DELETE operations only]: Comma-separated list of values

## Output Format

- **success** (boolean): Indicates whether the database operation was successful
- **result** (array) [SELECT operations only]: The data returned by the database operation
- **affectedRows** (number) [INSERT, UPDATE, DELETE operations only]: The number of rows affected by the operation
- **error** (string): Error message if the database operation failed
