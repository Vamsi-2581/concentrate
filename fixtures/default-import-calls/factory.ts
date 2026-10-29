// The default export is a variable made at runtime; the nested function of
// the same name must not become the call target.
const createInstance = () => {
  const instance = (): number => 3;
  return instance;
};
const instance = createInstance();
export default instance;
