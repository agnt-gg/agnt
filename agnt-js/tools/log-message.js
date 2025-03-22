export async function execute(params) {
  const { message } = params;
  console.log(message);
  return { logged: true, message: message };
}
