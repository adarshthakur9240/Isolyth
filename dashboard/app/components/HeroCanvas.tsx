"use client";

import { useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Float } from "@react-three/drei";
import * as THREE from "three";

function SandboxedScene() {
  const outerBoxRef = useRef<THREE.Mesh>(null!);
  const innerGroupRef = useRef<THREE.Group>(null!);
  const poly1Ref = useRef<THREE.Mesh>(null!);
  const poly2Ref = useRef<THREE.Mesh>(null!);
  const poly3Ref = useRef<THREE.Mesh>(null!);

  useFrame((state, delta) => {
    // Gentle rotation of the outer boundary box
    if (outerBoxRef.current) {
      outerBoxRef.current.rotation.x += delta * 0.15;
      outerBoxRef.current.rotation.y += delta * 0.2;
    }

    // Individual polyhedra rotations
    if (poly1Ref.current) {
      poly1Ref.current.rotation.x += delta * 0.5;
      poly1Ref.current.rotation.y += delta * 0.4;
    }
    if (poly2Ref.current) {
      poly2Ref.current.rotation.y += delta * 0.6;
      poly2Ref.current.rotation.z += delta * 0.3;
    }
    if (poly3Ref.current) {
      poly3Ref.current.rotation.x += delta * 0.4;
      poly3Ref.current.rotation.z += delta * 0.5;
    }

    // Parallax mouse interaction
    const targetX = state.pointer.x * 0.4;
    const targetY = state.pointer.y * 0.4;

    if (innerGroupRef.current) {
      innerGroupRef.current.rotation.y = THREE.MathUtils.lerp(
        innerGroupRef.current.rotation.y,
        targetX,
        0.05
      );
      innerGroupRef.current.rotation.x = THREE.MathUtils.lerp(
        innerGroupRef.current.rotation.x,
        -targetY,
        0.05
      );
    }
  });

  return (
    <group ref={innerGroupRef}>
      {/* Outer Sandboxed Wireframe Boundary */}
      <mesh ref={outerBoxRef}>
        <boxGeometry args={[3.4, 3.4, 3.4]} />
        <meshBasicMaterial
          color="#f5d800"
          wireframe
          wireframeLinewidth={2}
          transparent
          opacity={0.35}
        />
      </mesh>

      {/* Floating WASM Polyhedra Modules */}
      <Float speed={2} rotationIntensity={0.6} floatIntensity={0.8}>
        {/* Module 1: Icosahedron (Electric Yellow) */}
        <mesh ref={poly1Ref} position={[-0.7, 0.4, 0.2]}>
          <icosahedronGeometry args={[0.75, 0]} />
          <meshStandardMaterial
            color="#f5d800"
            roughness={0.2}
            metalness={0.8}
            wireframe={false}
          />
        </mesh>

        {/* Module 2: Octahedron (Electric Blue) */}
        <mesh ref={poly2Ref} position={[0.8, -0.3, -0.2]}>
          <octahedronGeometry args={[0.65, 0]} />
          <meshStandardMaterial
            color="#00a8ff"
            roughness={0.15}
            metalness={0.85}
          />
        </mesh>

        {/* Module 3: Dodecahedron (Coral) */}
        <mesh ref={poly3Ref} position={[0.2, 0.7, -0.6]}>
          <dodecahedronGeometry args={[0.5, 0]} />
          <meshStandardMaterial
            color="#ff4757"
            roughness={0.3}
            metalness={0.7}
          />
        </mesh>
      </Float>

      {/* Ambient & Point Lights */}
      <ambientLight intensity={0.6} />
      <pointLight position={[10, 10, 10]} intensity={1.5} color="#f5d800" />
      <pointLight position={[-10, -10, -10]} intensity={1.2} color="#00a8ff" />
      <directionalLight position={[0, 5, 5]} intensity={1} color="#ffffff" />
    </group>
  );
}

export default function HeroCanvas() {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        position: "absolute",
        inset: 0,
        pointerEvents: "auto",
        zIndex: 0,
      }}
    >
      <Canvas
        camera={{ position: [0, 0, 6], fov: 45 }}
        gl={{ antialias: true, alpha: true }}
        style={{ background: "transparent" }}
      >
        <SandboxedScene />
      </Canvas>
    </div>
  );
}
