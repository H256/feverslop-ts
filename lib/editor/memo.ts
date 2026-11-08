// A memo of the most recently used `max` results. The editor keys its media caches by file and modification time, so
// every re-render of a file makes a new key - without a bound the entries of the old versions would stay for as long as
// the server lives.
export function boundedMemo<V>(max: number): (key: string, make: () => V) => V {
    const entries = new Map<string, V>()
    return (key, make) => {
        if (entries.has(key)) {
            const value = entries.get(key)!
            entries.delete(key)        // the Map keeps insertion order: re-inserting makes it the newest
            entries.set(key, value)
            return value
        }
        const value = make()
        entries.set(key, value)
        if (entries.size > max) entries.delete(entries.keys().next().value!)
        return value
    }
}
