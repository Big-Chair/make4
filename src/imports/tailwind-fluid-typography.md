Fluid Typography in Tailwind v4 + Shadcn

Tailwind v4 and Shadcn do not include fluid typography out of the box. Shadcn uses standard Tailwind classes (like text-xl, text-2xl), which map to static pixel values by default.

To make Shadcn components fluid, you need to override the default font sizes in your Tailwind CSS configuration.

The "New Way" (Tailwind v4 CSS-first config)

In v4, you no longer need tailwind.config.js for most theme settings. You define them directly in your CSS using the @theme block.

1. Open your main CSS file

This is where you import Tailwind (e.g., globals.css or app.css).

2. Add the @theme block

You can override the standard sizes (--text-*) with your clamp() formulas.

@import "tailwindcss";

@theme {
  /* Override default Tailwind sizes with Fluid Clamp values.
     Shadcn components using 'text-xl' will instantly become fluid.
  */

  /* Example: Base text scales from 16px to 18px */
  --text-base: clamp(1rem, 0.9rem + 0.5vw, 1.125rem);

  /* Example: Large text scales from 18px to 24px */
  --text-lg: clamp(1.125rem, 1rem + 0.8vw, 1.5rem);

  /* Example: XL text scales from 20px to 30px */
  --text-xl: clamp(1.25rem, 1rem + 1.5vw, 1.875rem);

  /* Example: 2XL scales from 24px to 36px */
  --text-2xl: clamp(1.5rem, 1rem + 2.5vw, 2.25rem);
  
  /* ... repeat for 3xl, 4xl, etc. */
}


How this affects Shadcn UI

Shadcn components are built using standard Tailwind utility classes. For example, a CardTitle component might look like this internally:

<h3 className="font-semibold leading-none tracking-tight text-2xl">
  {children}
</h3>


Because it uses text-2xl, and you have redefined what --text-2xl is in your CSS theme, the Shadcn component automatically becomes fluid. You do not need to edit the Shadcn components themselves.

Pro Tip: Using Arbitrary Values

If you don't want to change the whole theme but need a specific fluid header, Tailwind v4 allows clamp directly in the class name without configuration:

<h1 class="text-[clamp(2rem,4vw,4rem)]">
  Massive Fluid Header
</h1>


Summary

Does Tailwind v4 do it default? No.

Does Shadcn do it default? No.

The Fix: Override --text-sm, --text-lg, etc., in your CSS @theme block with clamp() values. Shadcn will inherit these changes instantly.