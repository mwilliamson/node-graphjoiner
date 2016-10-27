# GraphJoiner: Implementing GraphQL with joins

In the reference GraphQL implementation, resolve functions describe how to
fulfil some part of the requested data for each instance of an object.
If implemented naively with a SQL backend, this results in the N+1 problem.
For instance, given the query:

    {
        books(genre: "comedy") {
            title
            author {
                name
            }
        }
    }

A naive GraphQL implementation would issue one SQL query to get the list of all
books in the comedy genre, and then N queries to get the author of each book
(where N is the number of books returned by the first query).

There are various solutions proposed to this problem: GraphJoiner suggests that
using joins is a natural fit for many use cases. For this specific case, we only
need to run two queries: one to find the list of all books in the comedy genre,
and one to get the authors of books in the comedy genre.

## Example

Let's say we have a SQL database which we access using Knex.
A book has an ID, a title and an author ID.
An author has an ID and a name.

```javascript
import sql from "sql-gen";

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
```

We then define types for the root, books and authors:

```javascript
import { JoinType, RootJoinType, field, single, many } from "graphjoiner";
import { fromPairs, mapKeys, zip } from "lodash";

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

function executeQuery(query) {
    const {text, params} = sql.compile(query);
    return Promise.fromCallback(callback => database.all(text, ...params, callback));
}

const fetchImmediatesFromQuery = table => (selections, sqlQuery) => {
    const requestedColumns = selections.map(selection => table.c[selection.field.columnName].as(selection.key));
    const primaryKeyColumns = table.primaryKey.columns
        .map(column => column.as("_primaryKey_" + column.key()));
    const columns = requestedColumns.concat(primaryKeyColumns);
    const immediatesQuery = sqlQuery.select(...columns).distinct();
    return executeQuery(immediatesQuery);
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
```

We can execute the query by calling `execute`:

```javascript

import { execute } from "graphjoiner";

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
execute(Root, query)
```

Or by turning the types into ordinary GraphQL types:

```javascript
import { graphql, GraphQLSchema } from "graphql";

const schema = new GraphQLSchema({
    query: Root.toGraphQLType()
});

graphql(schema, query).then(result => result.data);
```

Which produces:

    {
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
    }

Let's break things down a little, starting with the definition of the root object:

```javascript
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
```

For each object type, we need to define its fields.
The root has only one field, `books`, a one-to-many relationship,
which we define using `many()`.
The first argument, `Book`,
is the object type we're defining a relationship to.
The second argument describes how to create a query representing all of those
related books: in this case all books, potentially filtered by a genre argument.

This means we need to define `Book`:

```javascript
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
```

The `author` field is defined as a one-to-one mapping from book to author.
As before, we define a function that generates a query for the requested authors.
We also provide a `join` argument to `single()` so that GraphJoiner knows
how to join together the results of the author query and the book query:
in this case, the `authorId` field on books corresponds to the `id` field
on authors.
(If we leave out the `join` argument, then GraphJoiner will perform a cross
join i.e. a cartesian product. Since there's always exactly one root instance,
this is fine for relationships defined on the root.)

The remaining fields define a mapping from the GraphQL field to the database
column. This mapping is handled by `fetchImmediatesFromQuery()`.
The value of `selections` in `fetchImmediates()`
is the requested fields that aren't defined as relationships
(using `single` or `many`) that were either explicitly requested in the
original GraphQL query, or are required as part of the join.

```javascript
const fetchImmediatesFromQuery = table => (selections, sqlQuery) => {
    const requestedColumns = selections.map(selection => table.c[selection.field.columnName].as(selection.key));
    const primaryKeyColumns = table.primaryKey.columns
        .map(column => column.as("_primaryKey_" + column.key()));
    const columns = requestedColumns.concat(primaryKeyColumns);
    const immediatesQuery = sqlQuery.select(...columns).distinct();
    return executeQuery(immediatesQuery);
};
```

For completeness, we can tweak the definition of `Author` so
we can request the books by an author:

```javascript
const Author = new JoinType({
    name: "Author",

    fields() {
        return {
            id: field({columnName: "id", type: GraphQLInt}),
            name: field({columnName: "name", type: GraphQLString}),
            books: many({
                target: Book,
                select: (args, authorQuery}) => {
                    const authors = authorQuery.subquery();
                    return sql.from(BookTable)
                        .join(authors, sql.eq(authors.c.id, BookTable.c.authorId));
                },
                join: {"id": "authorId"}
            })
        };
    },

    fetchImmediates: fetchImmediatesFromQuery(AuthorTable)
});
```

## Installation

    npm install graphjoiner

## API

### `JoinType`

#### `new JoinType({name, fields, fetchImmediates})`

Create a new `JoinType`.

* `name`: the name of the type.

* `fields`: an object mapping names to each field.
  Each field should either be an immediate field created by `field()`,
  or a relationship to another type.

* `fetchImmediates(selections, select)`:
  a function to fetch the immediates for a node in the request.
  `selections` is a list of objects with the properties:
    * `key`: the key of the selection.
      This is the alias specified in the GraphQL request,
      or the name of the field if no alias was specified.
    * `field`: the field of the selection.
      This will be one of the values passed in the `fields` property when
      constructing the `JoinType`.
  `select` is the selector for this node in the request.

  `fetchImmediates` should return a list of objects,
  where each object has a property named after the key of each selection.

### Fields

#### `field({type, ...props})`

Defines an immediate field.
At least `type` must be provided, which should be a GraphQL type such as `GraphQLString`.
All properties are available by the same name on the returned field.

#### `single({targetType, select, join, args})`

Create a one-to-one relationship.
The GraphQL type of the field will be the GraphQL type of `targetType`.

This takes a single object argument with the properties:

* `targetType` (required). The join type that this relationship joins to.

* `select(args, select)` (required).
  A function that generates the selector to be used when fetching instances of the target type for this field.

* `join` (optional): an object describing
  how to join together instances of the parent type and the target type.
  The keys should correspond to field names on the parent type,
  while the values should correspond to field names on the target type.

  For instance, suppose we're defining a `books` field on an `Author` type.
  If each book has an `authorId` field, and each author has an `id` field,
  then `join` should be `{"id": "authorId"}`.
  If not specified, GraphJoiner performs a cross join.

* `args` (optional): the arguments that may be passed to this field.
  This should be defined in the same way as arguments on an ordinary
  GraphQL field, such as `{genre: {type: GraphQLString}}`.

#### `many({targetType, select, join, args})`

Create a one-to-many relationship.
The GraphQL type of the field will be a list of the GraphQL type of `targetType`.
The arguments to `many()` are the same as those for `single()`.

#### `extract(relationship, fieldName)`

Given a relationship,
such as those returned by `single()` and `many()`,
create a new relationship that extracts a given field.

For instance, suppose an author type has a field `books` that describes all books by that author.
We can define a field `bookTitles` that describes the title of all books by that author
by calling `extract(books, "title")`:

```javascript
new JoinType({
    "Author",
    fields: {
        books: books,
        bookTitles: extract(books, "title")
    },
    fetchImmediates: ...
})
```

### `RootJoinType`

A `RootJoinType` behaves similarly to `JoinType`,
except that:

* there is always exactly one instance

* there are no immediate fields

As a result, there is no need to pass `fetchImmediates` when constructing
a `RootJoinType`.

