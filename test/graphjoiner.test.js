import assert from "assert";

import { fromPairs } from "lodash";

import { ObjectType, RootObjectType, single, many, execute } from "../lib";

const allAuthors = [
    {id: 1, name: "PG Wodehouse"},
    {id: 2, name: "Joseph Heller"}
];

const allBooks = [
    {id: 1, title: "Leave It to Psmith", authorId: 1},
    {id: 2, title: "Right Ho, Jeeves", authorId: 1},
    {id: 3, title: "Catch-22", authorId: 2}
];

function fetchImmediatesFromObj(request, objs) {
    const requestedProperties = request.requestedFields.map(field => this.fields()[field]);

    function readObj(obj) {
        return fromPairs(requestedProperties.map(property => [property, obj[property]]));
    }

    return objs.map(readObj);
}

const Author = new ObjectType({
    name: "Author",

    fields() {
        return {
            id: "id",
            name: "name",
            books: many(
                Book,
                () => allBooks,
                {"id": "authorId"}
            )
        };
    },

    fetchImmediates: fetchImmediatesFromObj
});

const Book = new ObjectType({
    name: "Book",

    fields() {
        return {
            id: "id",
            title: "title",
            authorId: "authorId",
            author: single(
                Author,
                () => allAuthors,
                {"authorId": "id"}
            )
        };
    },

    fetchImmediates: fetchImmediatesFromObj
});


const Root = new RootObjectType({
    name: "Query",

    fields() {
        return {
            "books": many(Book, () => allBooks),
            "author": single(Author, request => {
                let authors = allAuthors;

                const authorId = parseInt(request.args["id"], 10);
                if (authorId != null) {
                    authors = authors.filter(author => author.id === authorId);
                }

                return authors;
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
