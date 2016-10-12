import assert from "assert";
import { fromPairs, map, mapKeys, mapValues, zip } from "lodash";
import { graphql, GraphQLSchema, GraphQLInt, GraphQLString } from "graphql";
import sqlite3 from "sqlite3";
import Promise from "bluebird";

import { JoinType, RootJoinType, field, single, many, extract, execute } from "../lib";
import { testCases } from "./executionTestCases";

import sql from "sql-gen";


exports[module.filename] = () => {
    const AuthorTable = sql.table("author", {
        id: sql.column({name: "id", type: sql.types.int, primaryKey: true}),
        name: sql.column({name: "name", type: sql.types.string})
    });
    const BookTable = sql.table("book", {
        id: sql.column({name: "id", type: sql.types.int, primaryKey: true}),
        title: sql.column({name: "title", type: sql.types.string}),
        genre: sql.column({name: "genre", type: sql.types.string}),
        authorId: sql.column({name: "author_id", type: sql.types.int})
    });
    
    const database = new sqlite3.Database(":memory:");
    
    function executeQuery(query) {
        const {text, params} = sql.compile(query);
        return Promise.fromCallback(callback => database.all(text, ...params, callback));
    }
    
    function executeStatement(statement) {
        const {text, params} = sql.compile(statement);
        return Promise.fromCallback(callback => database.run(text, ...params, callback));
    }

    let result;
    
    database.serialize(() => {
    
        function insertAuthor({id, name}) {
            database.run("INSERT INTO author (id, name) VALUES (?, ?)", id, name);
        }

        function insertBook({id, title, genre, authorId}) {
            database.run("INSERT INTO book (id, title, genre, author_id) VALUES (?, ?, ?, ?)", id, title, genre, authorId);
        }
        
        executeStatement(sql.createTable(AuthorTable));
        executeStatement(sql.createTable(BookTable));
        
        // TODO: inserts
        insertAuthor({id: 1, name: "PG Wodehouse"});
        insertAuthor({id: 2, name: "Joseph Heller"});
        insertBook({id: 1, title: "Leave It to Psmith", genre: "comedy", authorId: 1});
        insertBook({id: 2, title: "Right Ho, Jeeves", genre: "comedy", authorId: 1});
        insertBook({id: 3, title: "Catch-22", genre: "comedy", authorId: 2});

        const Root = new RootJoinType({
            name: "Query",

            fields() {
                return {
                    "books": many({
                        target: Book,
                        select: args => {
                            let books = sql.from(BookTable);

                            if ("genre" in args) {
                                books = books.where(sql.eq(BookTable.c.genre, args["genre"]));
                            }

                            return books;
                        },
                        args: {genre: {type: GraphQLString}}
                    })
                };
            }
        });

        const fetchImmediatesFromQuery = table => (selections, sqlQuery) => {
            const requestedColumns = selections.map(selection => table.c[selection.field.columnName].as(selection.key));
            // TODO: Should include primary key columns for distinct to work correctly
            return executeQuery(sqlQuery.select(...requestedColumns).distinct());
        };

        const Book = new JoinType({
            name: "Book",

            fields() {
                return {
                    id: field({columnName: "id", type: GraphQLInt}),
                    title: field({columnName: "title", type: GraphQLString}),
                    genre: field({columnName: "genre", type: GraphQLString}),
                    authorId: field({columnName: "authorId", type: GraphQLInt}),
                    author: single({
                        target: Author,
                        select: (args, bookQuery) => {
                            const books = bookQuery.select(BookTable.c.authorId).subquery();
                            return sql.from(AuthorTable)
                                .join(books, sql.eq(books.c.authorId, AuthorTable.c.id));
                        },
                        join: {"authorId": "id"}
                   } )
                };
            },

            fetchImmediates: fetchImmediatesFromQuery(BookTable)
        });

        const Author = new JoinType({
            name: "Author",

            fields() {
                return {
                    id: field({columnName: "id", type: GraphQLInt}),
                    name: field({columnName: "name", type: GraphQLString})
                };
            },

            fetchImmediates: fetchImmediatesFromQuery(AuthorTable)
        });

        const query = `
            {
                books(genre: "comedy") {
                    title
                    author {
                        name
                    }
                }
            }
        `;

        result = execute(Root, query).then(data => assert.deepEqual(data, {
            "books": [
                {
                    "title": "Leave It to Psmith",
                    "author": {
                        "name": "PG Wodehouse"
                    }
                },
                {
                    "title": "Right Ho, Jeeves",
                    "author": {
                        "name": "PG Wodehouse"
                    }
                },
                {
                    "title": "Catch-22",
                    "author": {
                        "name": "Joseph Heller"
                    }
                },
            ]
        }));
    });
    return result;
};
