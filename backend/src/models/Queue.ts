export default class Queue<T> {
  private readonly items: T[] = [];

  isEmpty() {
    return 0 === this.items.length;
  }

  size() {
    return this.items.length;
  }

  enqueue(item: T) {
    this.items.push(item);
  }

  dequeue() {
    return this.items.shift();
  }
}

export class IndexedQueue<K, T> {
  private readonly indexes: Map<K, number> = new Map();
  protected items: T[] = [];

  isEmpty() {
    return 0 === this.items.length;
  }

  size() {
    return this.items.length;
  }

  head(at: number = 0): T | undefined {
    return this.items[at];
  }

  enqueue(index: K, item: T) {
    this.indexes.set(index, this.items.length);
    this.items.push(item);
  }

  dequeue() {
    const index = this.indexes.keys().next().value;
    if (undefined !== index) {
      this.indexes.delete(index);
      return this.items.shift();
    }
  }

  remove(index: K) {
    const itemIndex = this.indexes.get(index);
    if (undefined === itemIndex) return void 0;
    this.indexes.delete(index);
    this.items = this.items.filter(
      (_, currentIndex) => currentIndex !== itemIndex,
    );
  }

  indexAt(index: number): K {
    const itemIndex = this.indexes
      .entries()
      .filter((e) => e[1] === index)
      .toArray()[0][0];
    return itemIndex;
  }

  protected update(index: K, newItem: T) {
    const itemIndex = this.indexes.get(index);
    if (undefined === itemIndex) return false;
    this.items[itemIndex] = newItem;
    return true;
  }

  protected find(index: K): T | undefined {
    const itemIndex = this.indexes.get(index);
    if (undefined === itemIndex) return undefined;
    return this.items[itemIndex];
  }
}
