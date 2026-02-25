import Image from 'next/image';

export function Header() {
  return (
    <header>
      <Image src="/images/logo.png" alt="Logo" width={100} height={40} />
    </header>
  );
}
