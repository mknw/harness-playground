import { createSignal } from "solid-js";

export default function Counter() {
  const [count, setCount] = createSignal(0);
  return (
    <button
      class="px-[2rem] py-[1rem] border-2 border-gray-300 rounded-full bg-gray-100 w-[200px] active:border-gray-400 focus:border-gray-400"
      onClick={() => setCount(count() + 1)}
    >
      Clicks: {count()}
    </button>
  );
}
