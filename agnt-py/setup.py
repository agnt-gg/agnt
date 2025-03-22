from setuptools import setup, find_packages

setup(
    name="agnt-orchestrator",
    version="0.1.0",
    packages=find_packages(),
    install_requires=[
        "pydantic>=2.0.0",
        "aiohttp>=3.8.0",
        "importlib-metadata>=4.0.0",
        "colorama>=0.4.4",
        "python-dotenv>=1.0.0",
    ],
    python_requires=">=3.8",
    author="AGNT Team",
    author_email="team@agnt.com",
    description="Agentic Graph Network Technology Orchestrator",
    keywords="orchestrator, workflow, agent",
    classifiers=[
        "Development Status :: 3 - Alpha",
        "Intended Audience :: Developers",
        "Programming Language :: Python :: 3.8",
        "Programming Language :: Python :: 3.9",
        "Programming Language :: Python :: 3.10",
    ],
)