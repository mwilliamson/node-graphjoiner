import Immutable from "immutable";

export function toListMap(collection, generatePair) {
    return Immutable.Map().withMutations(map =>
        collection.forEach(element => {
            let [key, value] = generatePair(element);
            if (!map.has(key)) {
                map.set(key, []);
            }
            map.get(key).push(value);
        })
    );
};
