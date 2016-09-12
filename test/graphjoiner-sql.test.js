import assert from "assert";

import { fromPairs, invert, isString, mapKeys } from "lodash";

import { ObjectType, RootObjectType, single, many, execute } from "../lib";

import Knex from "knex";

let knex;

exports.beforeEach = () => {
    knex = Knex({
        dialect: "sqlite3",
        connection: {
            filename: ":memory:"
        }
    });

    return knex.schema
        .createTable("author", function(table) {
            table.increments("id");
            table.string("name");
        })
        .createTable("book", function(table) {
            table.increments("id");
            table.string("title");
            table.integer("author_id").unsigned().references("author.id")
        })
        .then(() => knex.insert([
            {id: 1, name: "PG Wodehouse"},
            {id: 2, name: "Joseph Heller"}
        ]).into("author"))
        .then(() => knex.insert([
            {id: 1, title: "Leave It to Psmith", author_id: 1},
            {id: 2, title: "Right Ho, Jeeves", author_id: 1},
            {id: 3, title: "Catch-22", author_id: 2}
        ]).into("book"));
};

function fetchImmediatesFromQuery(request, {query}) {
    const fields = this.fields();
    const columnsToFields = invert(fields);
    const requestedColumns = request.requestedFields.map(field => fields[field]);
    return query.select(request.requestedColumns).then(records =>
        records.map(record =>
            mapKeys(record, (value, name) => columnsToFields[name])
        )
    );
}

const Author = new ObjectType({
    name: "Author",

    fields() {
        return {
            id: "id",
            name: "name",
            books: many(
                Book,
                (request, {query: authorQuery}) => ({
                    query: knex("book").join(
                        authorQuery.select("author.id").distinct().as("author"),
                        "book.author_id",
                        "author.id"
                    )
                }),
                {"id": "authorId"}
            )
        };
    },

    fetchImmediates: fetchImmediatesFromQuery
});

const Book = new ObjectType({
    name: "Book",

    fields() {
        return {
            id: "id",
            title: "title",
            authorId: "author_id",
            author: single(
                Author,
                (request, {query: bookQuery}) => ({
                    query: knex("author").join(
                        bookQuery.select("book.author_id").distinct().as("book"),
                        "author.id",
                        "book.author_id"
                    )
                }),
                {"authorId": "id"}
            )
        };
    },

    fetchImmediates: fetchImmediatesFromQuery
});


const Root = new RootObjectType({
    name: "Query",

    fields() {
        return {
            "books": many(Book, () => ({query: knex("book")})),
            "author": single(Author, request => {
                let authors = knex("author");

                const authorId = parseInt(request.args["id"], 10);
                if (authorId != null) {
                    authors = authors.where("id", "=", authorId);
                }

                return {query: authors};
            })
        };
    }
});

exports["query list of entities"] = () => {
    const query = `
        {
            books {
                id
                title
            }
        }
    `;

    return execute(Root, query).then(result =>
        assert.deepEqual(result, {
            "books": [
                {
                    "id": 1,
                    "title": "Leave It to Psmith",
                },
                {
                    "id": 2,
                    "title": "Right Ho, Jeeves",
                },
                {
                    "id": 3,
                    "title": "Catch-22",
                }
            ]
        })
    );
}



exports["querying list of entities with child entity"] = () => {
    const query = `
        {
            books {
                id
                author {
                    name
                }
            }
        }
    `;

    return execute(Root, query).then(result =>
        assert.deepEqual(result, {
            "books": [
                {
                    "id": 1,
                    "author": {
                        "name": "PG Wodehouse",
                    }
                },
                {
                    "id": 2,
                    "author": {
                        "name": "PG Wodehouse",
                    }
                },
                {
                    "id": 3,
                    "author": {
                        "name": "Joseph Heller",
                    }
                }
            ]
        })
    );
}



exports["querying single entity with arg"] = () => {
    const query = `
        {
            author(id: 1) {
                name
            }
        }
    `;

    return execute(Root, query).then(result =>
        assert.deepEqual(result, {
            "author": {
                "name": "PG Wodehouse"
            }
        })
    );
};


exports["single entity is null if not found"] = () => {
    const query = `
        {
            author(id: 100) {
                name
            }
        }
    `;

    return execute(Root, query).then(result =>
        assert.deepEqual(result, {
            "author": null,
        })
    );
}


exports["querying single entity with child entities"] = () => {
    const query = `
        {
            author(id: 1) {
                books {
                    title
                }
            }
        }
    `;

    return execute(Root, query).then(result =>
        assert.deepEqual(result, {
            "author": {
                "books": [
                    {"title": "Leave It to Psmith"},
                    {"title": "Right Ho, Jeeves"},
                ],
            },
        })
    );
};
