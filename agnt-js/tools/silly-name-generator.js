export async function execute(params, context) {
  const { numNames = 1 } = params;
  
  const adjectives = ['Silly', 'Fuzzy', 'Bouncy', 'Giggly', 'Wobbly', 'Sparkly', 'Twinkly', 'Bubbly', 'Wiggly', 'Fluffy'];
  const nouns = ['Penguin', 'Unicorn', 'Potato', 'Banana', 'Flamingo', 'Noodle', 'Pickle', 'Muffin', 'Pancake', 'Cupcake'];
  
  const generateName = () => {
    const adjective = adjectives[Math.floor(Math.random() * adjectives.length)];
    const noun = nouns[Math.floor(Math.random() * nouns.length)];
    return `${adjective} ${noun}`;
  };
  
  if (numNames === 1) {
    return { name: generateName() };
  } else {
    const names = [];
    for (let i = 0; i < numNames; i++) {
      names.push(generateName());
    }
    return { names };
  }
}