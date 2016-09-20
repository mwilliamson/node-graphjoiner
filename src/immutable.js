// @flow

import {Map} from "immutable";
import type {Iterable} from "immutable";

export function toListMap<V1, K2, V2>(
    collection: Iterable<*, V1>,
    generatePair: (value: V1) => [K2, V2]
): Map<K2, Array<V2>> {
    return Map().withMutations(map =>
        collection.forEach(element => {
            let [key, value] = generatePair(element);
            if (!map.has(key)) {
                map.set(key, []);
            }
            map.get(key).push(value);
        })
    );
};
